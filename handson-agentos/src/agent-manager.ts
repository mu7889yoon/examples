import { AgentOs } from "@rivet-dev/agent-os-core";
import pi from "@rivet-dev/agent-os-pi";
import type {
  AgentInstance,
  AgentResult,
  AppConfig,
  ParsedEvent,
} from "./types.js";
import { parseSessionEvent } from "./event-parser.js";

const MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

// ── createAgents ─────────────────────────────────────────────────

export async function createAgents(
  config: AppConfig,
): Promise<AgentInstance[]> {
  const ids = Array.from({ length: config.agentCount }, (_, i) => i + 1);

  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const vm = await AgentOs.create({ software: [pi] });
      return {
        id,
        name: `Agent-${id}`,
        vm,
        sessionId: null,
        status: "waiting" as const,
        startTime: Date.now(),
        endTime: null,
      } satisfies AgentInstance;
    }),
  );

  return settled.map((result, idx) => {
    if (result.status === "fulfilled") return result.value;
    return {
      id: idx + 1,
      name: `Agent-${idx + 1}`,
      vm: null,
      sessionId: null,
      status: "error" as const,
      startTime: Date.now(),
      endTime: Date.now(),
    } satisfies AgentInstance;
  });
}

// ── createSessions ───────────────────────────────────────────────

export async function createSessions(
  agents: AgentInstance[],
  config: AppConfig,
): Promise<void> {
  const { awsCredentials } = config;

  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.status === "error" || !agent.vm) return;

      try {
        const vm = agent.vm as AgentOs;

        // Write Pi settings to configure Bedrock model before session creation
        const piSettings = JSON.stringify({
          defaultProvider: "amazon-bedrock",
          defaultModel: MODEL_ID,
        });
        await vm.mkdir("/home/user/.pi/agent", { recursive: true });
        await vm.writeFile("/home/user/.pi/agent/settings.json", piSettings);

        const { sessionId } = await vm.createSession("pi", {
          env: {
            AWS_ACCESS_KEY_ID: awsCredentials.accessKeyId,
            AWS_SECRET_ACCESS_KEY: awsCredentials.secretAccessKey,
            AWS_SESSION_TOKEN: awsCredentials.sessionToken,
            AWS_REGION: awsCredentials.region,
          },
        });
        agent.sessionId = sessionId;
      } catch {
        agent.status = "error";
        agent.endTime = Date.now();
      }
    }),
  );
}

// ── runAllAgents ─────────────────────────────────────────────────

export async function runAllAgents(
  agents: AgentInstance[],
  prompt: string,
  onEvent: (agentId: number, event: ParsedEvent) => void,
): Promise<void> {
  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.status === "error" || !agent.vm || !agent.sessionId) return;

      try {
        agent.status = "thinking";
        agent.startTime = Date.now();

        const vm = agent.vm as AgentOs;
        const sessionId = agent.sessionId;

        // Auto-approve permission requests so the agent can write files / run commands
        vm.onPermissionRequest(sessionId, (req) => {
          vm.respondPermission(sessionId, req.permissionId, "always");
        });

        // Subscribe to session events and forward as ParsedEvent
        vm.onSessionEvent(sessionId, (notification) => {
          const parsed = parseSessionEvent({
            method: notification.method,
            params: notification.params as any,
          });
          onEvent(agent.id, parsed);

          if (parsed.kind === "file_write") {
            agent.status = "coding";
          } else if (parsed.kind === "command_exec") {
            agent.status = "running";
          } else if (parsed.kind === "thinking") {
            if (agent.status !== "coding" && agent.status !== "running") {
              agent.status = "thinking";
            }
          }
        });

        // Send prompt and wait for completion
        await vm.prompt(sessionId, prompt);

        agent.status = "completed";
        agent.endTime = Date.now();
      } catch {
        agent.status = "error";
        agent.endTime = Date.now();
      }
    }),
  );
}

// ── collectResults ───────────────────────────────────────────────

export async function collectResults(
  agents: AgentInstance[],
): Promise<AgentResult[]> {
  const settled = await Promise.allSettled(
    agents.map(async (agent): Promise<AgentResult> => {
      const elapsed = (agent.endTime ?? Date.now()) - agent.startTime;

      if (agent.status === "error" || !agent.vm) {
        return {
          agentId: agent.id, agentName: agent.name,
          code: null, language: null, filePath: null,
          stdout: null, stderr: null, exitCode: null,
          error: "Agent failed before result collection",
          elapsedMs: elapsed, metrics: null,
        };
      }

      const vm = agent.vm as AgentOs;
      let code: string | null = null;
      let language: string | null = null;
      let filePath: string | null = null;
      let stdout: string | null = null;
      let stderr: string | null = null;
      let exitCode: number | null = null;
      let error: string | null = null;

      // Read generated code from the VM
      try {
        const files = await vm.readdir("/home");
        const codeFile = findCodeFile(files);
        if (codeFile) {
          const fullPath = codeFile.startsWith("/") ? codeFile : `/home/${codeFile}`;
          filePath = fullPath;
          language = detectLanguage(fullPath);
          const buf = await vm.readFile(fullPath);
          code = new TextDecoder().decode(buf);
        }
      } catch {
        error = "Failed to read generated code";
      }

      // Execute with 30s timeout
      if (filePath && !error) {
        try {
          const command = buildRunCommand(filePath, language);
          const result = await execWithTimeout(vm, command, 30_000);
          stdout = result.stdout ?? null;
          stderr = result.stderr ?? null;
          exitCode = result.exitCode ?? null;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            error = "Execution timed out (30s)";
          } else {
            error = `Execution failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      }

      return {
        agentId: agent.id, agentName: agent.name,
        code, language, filePath, stdout, stderr, exitCode,
        error, elapsedMs: elapsed, metrics: null,
      };
    }),
  );

  return settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          agentId: 0, agentName: "Unknown",
          code: null, language: null, filePath: null,
          stdout: null, stderr: null, exitCode: null,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          elapsedMs: 0, metrics: null,
        },
  );
}

// ── disposeAll ───────────────────────────────────────────────────

export async function disposeAll(agents: AgentInstance[]): Promise<void> {
  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.vm) {
        try { await (agent.vm as AgentOs).dispose(); } catch { /* best-effort */ }
      }
    }),
  );
}

// ── Internal helpers ─────────────────────────────────────────────

async function execWithTimeout(
  vm: AgentOs,
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await vm.exec(command, { signal: controller.signal });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function findCodeFile(files: string[]): string | null {
  const extensions = [".py", ".js", ".ts", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".sh"];
  for (const ext of extensions) {
    const match = files.find((f) => f.endsWith(ext));
    if (match) return match;
  }
  return files[0] ?? null;
}

function detectLanguage(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    py: "Python", js: "JavaScript", ts: "TypeScript", rb: "Ruby",
    rs: "Rust", go: "Go", java: "Java", c: "C", cpp: "C++", sh: "Shell",
  };
  return langMap[ext] ?? null;
}

function buildRunCommand(filePath: string, language: string | null): string {
  switch (language) {
    case "Python": return `python3 ${filePath}`;
    case "JavaScript": return `node ${filePath}`;
    case "TypeScript": return `npx tsx ${filePath}`;
    case "Ruby": return `ruby ${filePath}`;
    case "Rust": return `rustc ${filePath} -o /tmp/out && /tmp/out`;
    case "Go": return `go run ${filePath}`;
    case "Java": return `java ${filePath}`;
    case "C": return `gcc ${filePath} -o /tmp/out && /tmp/out`;
    case "C++": return `g++ ${filePath} -o /tmp/out && /tmp/out`;
    case "Shell": return `bash ${filePath}`;
    default: return `bash ${filePath}`;
  }
}
