import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeReport } from "../report-writer.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AgentResult, AgentState } from "../types.js";

describe("writeReport", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "report-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const sampleResults: AgentResult[] = [
    {
      agentId: 1,
      agentName: "Agent-1",
      code: 'console.log("hello")',
      language: "javascript",
      filePath: "/app/hello.js",
      stdout: "hello",
      stderr: null,
      exitCode: 0,
      error: null,
      elapsedMs: 1234,
      metrics: {
        agentId: 1,
        snapshots: [
          { timestamp: 1000, totalMB: 512, usedMB: 128, freeMB: 256, availableMB: 384 },
        ],
        peakUsedMB: 128,
        avgUsedMB: 128,
      },
    },
    {
      agentId: 2,
      agentName: "Agent-2",
      code: null,
      language: null,
      filePath: null,
      stdout: null,
      stderr: null,
      exitCode: null,
      error: "timeout",
      elapsedMs: 30000,
      metrics: null,
    },
  ];

  const sampleAgents: AgentState[] = [
    {
      id: 1,
      name: "Agent-1",
      color: "blue",
      status: "completed",
      statusIcon: "✅",
      elapsedMs: 1234,
      activities: [
        { kind: "thinking", icon: "💭", summary: "Thinking...", timestamp: 1000 },
        { kind: "file_write", icon: "📝", summary: "📝 hello.js", timestamp: 2000 },
      ],
      currentMemory: null,
      codePreview: null,
    },
    {
      id: 2,
      name: "Agent-2",
      color: "green",
      status: "error",
      statusIcon: "❌",
      elapsedMs: 30000,
      activities: [],
      currentMemory: null,
      codePreview: null,
    },
  ];

  it("creates output directory and writes all three files", async () => {
    const outputDir = join(tempDir, "nested", "output");
    await writeReport(outputDir, sampleResults, sampleAgents);

    const summary = JSON.parse(await readFile(join(outputDir, "summary.json"), "utf-8"));
    const sessionLog = JSON.parse(await readFile(join(outputDir, "session-log.json"), "utf-8"));
    const terminalOutput = await readFile(join(outputDir, "terminal-output.txt"), "utf-8");

    // summary.json
    expect(summary).toHaveLength(2);
    expect(summary[0].agentName).toBe("Agent-1");
    expect(summary[0].code).toBe('console.log("hello")');
    expect(summary[0].metrics.peakUsedMB).toBe(128);
    expect(summary[1].error).toBe("timeout");
    expect(summary[1].metrics).toBeNull();

    // session-log.json
    expect(sessionLog).toHaveLength(2);
    expect(sessionLog[0].activities).toHaveLength(2);
    expect(sessionLog[0].activities[0].kind).toBe("thinking");
    expect(sessionLog[1].status).toBe("error");

    // terminal-output.txt
    expect(terminalOutput).toContain("=== Agent-1 ===");
    expect(terminalOutput).toContain("Language: javascript");
    expect(terminalOutput).toContain('console.log("hello")');
    expect(terminalOutput).toContain("=== Agent-2 ===");
    expect(terminalOutput).toContain("Error: timeout");
  });

  it("handles empty results", async () => {
    await writeReport(tempDir, [], []);

    const summary = JSON.parse(await readFile(join(tempDir, "summary.json"), "utf-8"));
    const sessionLog = JSON.parse(await readFile(join(tempDir, "session-log.json"), "utf-8"));
    const terminalOutput = await readFile(join(tempDir, "terminal-output.txt"), "utf-8");

    expect(summary).toEqual([]);
    expect(sessionLog).toEqual([]);
    expect(terminalOutput).toBe("");
  });
});
