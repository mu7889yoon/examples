/**
 * Agent manager — spawns 5 Pi CLI processes in parallel on the host.
 *
 * Each agent runs in its own temp directory. Pi CLI is invoked in
 * RPC mode so we can stream events and collect results.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentInstance,
  AgentResult,
  AppConfig,
  ParsedEvent,
} from "./types.js";
import { parseSessionEvent } from "./event-parser.js";

const MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

// ── createAgents ─────────────────────────────────────────────────
// Creates temp directories for each agent (no VM needed).

export async function createAgents(
  config: AppConfig,
): Promise<AgentInstance[]> {
  const ids = Array.from({ length: config.agentCount }, (_, i) => i + 1);

  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const workDir = await mkdtemp(join(tmpdir(), `agent-${id}-`));
      return {
        id,
        name: `Agent-${id}`,
        vm: workDir, // reuse vm field to store workDir path
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
// No-op for host-based execution (sessions are created in runAllAgents).

export async function createSessions(
  _agents: AgentInstance[],
  _config: AppConfig,
): Promise<void> {
  // Nothing to do — Pi CLI handles session creation internally
}


// ── runAllAgents ─────────────────────────────────────────────────
// Spawns Pi CLI in --print mode for each agent in parallel.

export async function runAllAgents(
  agents: AgentInstance[],
  prompt: string,
  onEvent: (agentId: number, event: ParsedEvent) => void,
  config: AppConfig,
): Promise<void> {
  const { awsCredentials } = config;

  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.status === "error" || !agent.vm) return;

      const workDir = agent.vm as string;
      agent.status = "thinking";
      agent.startTime = Date.now();

      try {
        const result = await runPiCli({
          workDir,
          prompt,
          env: {
            AWS_ACCESS_KEY_ID: awsCredentials.accessKeyId,
            AWS_SECRET_ACCESS_KEY: awsCredentials.secretAccessKey,
            AWS_SESSION_TOKEN: awsCredentials.sessionToken,
            AWS_REGION: awsCredentials.region,
          },
          onOutput: (line) => {
            // Parse Pi CLI output as activity events
            if (line.includes("Writing") || line.includes("write")) {
              const parsed = parseSessionEvent({ method: "file_write", params: { path: line } });
              onEvent(agent.id, parsed);
              agent.status = "coding";
            } else if (line.includes("Running") || line.includes("bash") || line.includes("$")) {
              const parsed = parseSessionEvent({ method: "exec", params: { command: line } });
              onEvent(agent.id, parsed);
              agent.status = "running";
            } else if (line.trim().length > 0) {
              const parsed = parseSessionEvent({ method: "textGeneration", params: { text: line } });
              onEvent(agent.id, parsed);
            }
          },
        });

        agent.sessionId = "completed";
        agent.status = "completed";
        agent.endTime = Date.now();
      } catch {
        agent.status = "error";
        agent.endTime = Date.now();
      }
    }),
  );
}

interface RunPiCliOptions {
  workDir: string;
  prompt: string;
  env: Record<string, string>;
  onOutput?: (line: string) => void;
}

function runPiCli(options: RunPiCliOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const { workDir, prompt, env, onOutput } = options;

    const child = spawn(
      "npx",
      [
        "@mariozechner/pi-coding-agent",
        "--provider", "amazon-bedrock",
        "--model", MODEL_ID,
        "--print",
        "--no-session",
        "--thinking", "off",
        prompt,
      ],
      {
        cwd: workDir,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      if (onOutput) {
        for (const line of text.split("\n")) {
          if (line.trim()) onOutput(line);
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Pi CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
    });

    child.on("error", reject);

    // 120 second timeout
    setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Pi CLI timed out (120s)"));
    }, 120_000);
  });
}


// ── collectResults ───────────────────────────────────────────────
// Reads generated files from each agent's temp directory.

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
          error: "Agent failed",
          elapsedMs: elapsed, metrics: null,
        };
      }

      const workDir = agent.vm as string;
      let code: string | null = null;
      let language: string | null = null;
      let filePath: string | null = null;
      let error: string | null = null;

      try {
        const files = await readdir(workDir);
        const codeFile = findCodeFile(files.filter(f => !f.startsWith(".")));
        if (codeFile) {
          filePath = join(workDir, codeFile);
          language = detectLanguage(codeFile);
          code = await readFile(filePath, "utf-8");
        }
      } catch {
        error = "Failed to read generated code";
      }

      return {
        agentId: agent.id, agentName: agent.name,
        code, language, filePath,
        stdout: null, stderr: null, exitCode: null,
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
// Cleans up temp directories.

export async function disposeAll(agents: AgentInstance[]): Promise<void> {
  await Promise.allSettled(
    agents.map(async (agent) => {
      if (agent.vm && typeof agent.vm === "string") {
        try { await rm(agent.vm, { recursive: true, force: true }); } catch {}
      }
    }),
  );
}

// ── Internal helpers ─────────────────────────────────────────────

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
