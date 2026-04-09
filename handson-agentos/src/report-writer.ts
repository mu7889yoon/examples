import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentResult, AgentState } from "./types.js";

/**
 * --output-dir 指定時にブログ用レポートファイルを出力する
 */
export async function writeReport(
  outputDir: string,
  results: AgentResult[],
  agents: AgentState[],
): Promise<void> {
  // ディレクトリがなければ再帰的に作成
  await mkdir(outputDir, { recursive: true });

  // 1. summary.json — 各 Agent の結果サマリー
  const summary = results.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentName,
    code: r.code,
    language: r.language,
    stdout: r.stdout,
    error: r.error,
    elapsedMs: r.elapsedMs,
    metrics: r.metrics
      ? {
          peakUsedMB: r.metrics.peakUsedMB,
          avgUsedMB: r.metrics.avgUsedMB,
          snapshotCount: r.metrics.snapshots.length,
        }
      : null,
  }));
  await writeFile(
    join(outputDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8",
  );

  // 2. session-log.json — 各 Agent のアクティビティ履歴
  const sessionLog = agents.map((a) => ({
    agentId: a.id,
    agentName: a.name,
    status: a.status,
    elapsedMs: a.elapsedMs,
    activities: a.activities,
  }));
  await writeFile(
    join(outputDir, "session-log.json"),
    JSON.stringify(sessionLog, null, 2),
    "utf-8",
  );

  // 3. terminal-output.txt — プレーンテキストのサマリー
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`=== ${r.agentName} ===`);
    lines.push(`Language: ${r.language ?? "unknown"}`);
    lines.push(`Elapsed: ${r.elapsedMs}ms`);
    if (r.error) {
      lines.push(`Error: ${r.error}`);
    }
    if (r.code) {
      lines.push("--- Code ---");
      lines.push(r.code);
    }
    if (r.stdout) {
      lines.push("--- Output ---");
      lines.push(r.stdout);
    }
    lines.push("");
  }
  await writeFile(
    join(outputDir, "terminal-output.txt"),
    lines.join("\n"),
    "utf-8",
  );
}
