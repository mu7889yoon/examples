import { AgentOs } from "@rivet-dev/agent-os-core";
import type {
  AgentInstance,
  AgentResult,
  AppConfig,
  ParsedEvent,
} from "./types.js";
import { parseSessionEvent } from "./event-parser.js";
import { startMetricsCollection } from "./metrics-collector.js";

// ── createAgents ─────────────────────────────────────────────────
// 5つの AgentOs インスタンスを並列作成。
// 個別の VM 作成失敗は error ステータスで記録し、残りで継続する（要件 6.1）。

export async function createAgents(
  config: AppConfig,
): Promise<AgentInstance[]> {
  const ids = Array.from({ length: config.agentCount }, (_, i) => i + 1);

  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const vm = await AgentOs.create();
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
    if (result.status === "fulfilled") {
      return result.value;
    }
    // VM creation failed — mark as error, keep a placeholder
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
// 各 Agent に Pi セッションを作成し、Claude 4.6 Haiku を指定する。
// エラー状態の Agent はスキップする。

export async function createSessions(
  agents: AgentInstance[],
  config: AppConfig,
): Promise<void> {
  const { awsCredentials } = config;

  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.status === "error" || !agent.vm) return;

      try {
        const session = await agent.vm.createSession("pi", {
          env: {
            AWS_ACCESS_KEY_ID: awsCredentials.accessKeyId,
            AWS_SECRET_ACCESS_KEY: awsCredentials.secretAccessKey,
            AWS_SESSION_TOKEN: awsCredentials.sessionToken,
            AWS_REGION: awsCredentials.region,
          },
        });
        agent.sessionId = session.id ?? null;
        await session.setModel("claude-4-6-haiku");
      } catch {
        agent.status = "error";
        agent.endTime = Date.now();
      }
    }),
  );
}

// ── runAllAgents ─────────────────────────────────────────────────
// 全 Agent にプロンプトを並列送信し、Session Event をストリーミング受信する。
// 個別の Agent 失敗は他に影響しない（要件 6.2）。

export async function runAllAgents(
  agents: AgentInstance[],
  prompt: string,
  onEvent: (agentId: number, event: ParsedEvent) => void,
): Promise<void> {
  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.status === "error" || !agent.vm) return;

      try {
        agent.status = "thinking";
        agent.startTime = Date.now();

        const session = agent.vm.getSession(agent.sessionId);
        const stream = await session.sendMessage(prompt);

        for await (const rawEvent of stream) {
          const parsed = parseSessionEvent(rawEvent);
          onEvent(agent.id, parsed);

          // Update agent status based on event kind
          if (parsed.kind === "file_write") {
            agent.status = "coding";
          } else if (parsed.kind === "command_exec") {
            agent.status = "running";
          } else if (parsed.kind === "thinking") {
            if (agent.status !== "coding" && agent.status !== "running") {
              agent.status = "thinking";
            }
          }
        }

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
// 各 VM から生成コードを取得し、30秒タイムアウト付きで実行する。

export async function collectResults(
  agents: AgentInstance[],
): Promise<AgentResult[]> {
  const settled = await Promise.allSettled(
    agents.map(async (agent): Promise<AgentResult> => {
      const elapsed = (agent.endTime ?? Date.now()) - agent.startTime;

      if (agent.status === "error" || !agent.vm) {
        return {
          agentId: agent.id,
          agentName: agent.name,
          code: null,
          language: null,
          filePath: null,
          stdout: null,
          stderr: null,
          exitCode: null,
          error: "Agent failed before result collection",
          elapsedMs: elapsed,
          metrics: null,
        };
      }

      let code: string | null = null;
      let language: string | null = null;
      let filePath: string | null = null;
      let stdout: string | null = null;
      let stderr: string | null = null;
      let exitCode: number | null = null;
      let error: string | null = null;

      // Attempt to read generated code from the VM
      try {
        const files = await agent.vm.readDir("/home");
        const codeFile = findCodeFile(files);
        if (codeFile) {
          filePath = codeFile;
          language = detectLanguage(codeFile);
          code = await agent.vm.readFile(codeFile);
        }
      } catch {
        error = "Failed to read generated code";
      }

      // Execute the code with a 30-second timeout
      if (filePath && !error) {
        try {
          const command = buildRunCommand(filePath, language);
          const result = await execWithTimeout(agent.vm, command, 30_000);
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
        agentId: agent.id,
        agentName: agent.name,
        code,
        language,
        filePath,
        stdout,
        stderr,
        exitCode,
        error,
        elapsedMs: elapsed,
        metrics: null, // Metrics are attached externally by App.tsx
      };
    }),
  );

  return settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          agentId: 0,
          agentName: "Unknown",
          code: null,
          language: null,
          filePath: null,
          stdout: null,
          stderr: null,
          exitCode: null,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          elapsedMs: 0,
          metrics: null,
        },
  );
}

// ── disposeAll ───────────────────────────────────────────────────
// 全 VM を安全に dispose する。

export async function disposeAll(agents: AgentInstance[]): Promise<void> {
  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.vm) {
        try {
          await agent.vm.dispose();
        } catch {
          // Best-effort cleanup — ignore errors
        }
      }
    }),
  );
}


// ── Internal helpers ─────────────────────────────────────────────

async function execWithTimeout(
  vm: any,
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
  // Common code file extensions in priority order
  const extensions = [
    ".py",
    ".js",
    ".ts",
    ".rb",
    ".rs",
    ".go",
    ".java",
    ".c",
    ".cpp",
    ".sh",
  ];
  for (const ext of extensions) {
    const match = files.find((f) => f.endsWith(ext));
    if (match) return match;
  }
  return files[0] ?? null;
}

function detectLanguage(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    py: "Python",
    js: "JavaScript",
    ts: "TypeScript",
    rb: "Ruby",
    rs: "Rust",
    go: "Go",
    java: "Java",
    c: "C",
    cpp: "C++",
    sh: "Shell",
  };
  return langMap[ext] ?? null;
}

function buildRunCommand(filePath: string, language: string | null): string {
  switch (language) {
    case "Python":
      return `python3 ${filePath}`;
    case "JavaScript":
      return `node ${filePath}`;
    case "TypeScript":
      return `npx tsx ${filePath}`;
    case "Ruby":
      return `ruby ${filePath}`;
    case "Rust":
      return `rustc ${filePath} -o /tmp/out && /tmp/out`;
    case "Go":
      return `go run ${filePath}`;
    case "Java":
      return `java ${filePath}`;
    case "C":
      return `gcc ${filePath} -o /tmp/out && /tmp/out`;
    case "C++":
      return `g++ ${filePath} -o /tmp/out && /tmp/out`;
    case "Shell":
      return `bash ${filePath}`;
    default:
      return `bash ${filePath}`;
  }
}
