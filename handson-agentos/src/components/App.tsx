import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text } from "ink";
import { loadConfig, validateCredentials } from "../config.js";
import {
  createAgents,
  createSessions,
  runAllAgents,
  collectResults,
  disposeAll,
} from "../agent-manager.js";
import { writeReport } from "../report-writer.js";
import { startMetricsCollection } from "../metrics-collector.js";
import type {
  AppPhase,
  AgentState,
  AgentResult,
  AppConfig,
  ParsedEvent,
  AgentStatus,
} from "../types.js";
import { Banner } from "./Banner.js";
import { ProgressView } from "./ProgressView.js";
import { ResultView } from "./ResultView.js";

// ── Agent color mapping ──────────────────────────────────────────

const AGENT_COLORS: readonly string[] = [
  "blue",
  "green",
  "yellow",
  "magenta",
  "cyan",
];

// ── Status icon mapping ──────────────────────────────────────────

const STATUS_ICONS: Record<AgentStatus, string> = {
  waiting: "⏳",
  thinking: "🔄",
  coding: "📝",
  running: "▶",
  completed: "✅",
  error: "❌",
};

// ── Initial agent state factory ──────────────────────────────────

function createInitialAgentStates(count: number): AgentState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Agent-${i + 1}`,
    color: AGENT_COLORS[i] ?? "white",
    status: "waiting" as AgentStatus,
    statusIcon: STATUS_ICONS.waiting,
    elapsedMs: 0,
    activities: [],
    currentMemory: null,
    codePreview: null,
  }));
}

// ── App component ────────────────────────────────────────────────

export function App() {
  const [phase, setPhase] = useState<AppPhase>("initializing");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [results, setResults] = useState<AgentResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const agentsRef = useRef<AgentState[]>([]);

  // Keep ref in sync with state for use in async effects
  const updateAgents = useCallback(
    (updater: AgentState[] | ((prev: AgentState[]) => AgentState[])) => {
      setAgents((prev) => {
        const next =
          typeof updater === "function" ? updater(prev) : updater;
        agentsRef.current = next;
        return next;
      });
    },
    [],
  );

  // ── onEvent callback — updates agent state on each session event ──

  const handleEvent = useCallback(
    (agentId: number, event: ParsedEvent) => {
      updateAgents((prev) =>
        prev.map((agent) => {
          if (agent.id !== agentId) return agent;

          // Derive new status from event kind
          let newStatus: AgentStatus = agent.status;
          if (event.kind === "file_write") {
            newStatus = "coding";
          } else if (event.kind === "command_exec") {
            newStatus = "running";
          } else if (event.kind === "thinking") {
            if (agent.status !== "coding" && agent.status !== "running") {
              newStatus = "thinking";
            }
          }

          // Build code preview from file_write events
          let codePreview = agent.codePreview;
          if (
            event.kind === "file_write" &&
            event.raw &&
            typeof (event.raw as any).params?.content === "string"
          ) {
            codePreview = (event.raw as any).params.content;
          }

          return {
            ...agent,
            status: newStatus,
            statusIcon: STATUS_ICONS[newStatus],
            activities: [
              ...agent.activities,
              {
                kind: event.kind,
                icon: event.icon,
                summary: event.summary,
                timestamp: event.timestamp,
              },
            ],
            codePreview,
          };
        }),
      );
    },
    [updateAgents],
  );

  // ── Main lifecycle effect ──────────────────────────────────────

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      // 1. Load config & validate credentials
      let cfg: AppConfig;
      try {
        cfg = loadConfig();
      } catch (err) {
        setError(
          `設定の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      setConfig(cfg);

      const valid = await validateCredentials(cfg.awsCredentials);
      if (!valid) {
        setError(
          ".env ファイルに AWS credentials を設定してください",
        );
        return;
      }

      // Initialize agent states for UI
      updateAgents(createInitialAgentStates(cfg.agentCount));
      setPhase("running");

      // 2. Create AgentOs instances
      const agentInstances = await createAgents(cfg);
      if (disposed) return;

      // Update agent states with any creation errors
      updateAgents((prev) =>
        prev.map((a) => {
          const inst = agentInstances.find((ai) => ai.id === a.id);
          if (inst && inst.status === "error") {
            return {
              ...a,
              status: "error" as AgentStatus,
              statusIcon: STATUS_ICONS.error,
            };
          }
          return a;
        }),
      );

      // 3. Create Pi sessions + setModel
      await createSessions(agentInstances, cfg);
      if (disposed) return;

      // Update agent states with any session creation errors
      updateAgents((prev) =>
        prev.map((a) => {
          const inst = agentInstances.find((ai) => ai.id === a.id);
          if (inst && inst.status === "error") {
            return {
              ...a,
              status: "error" as AgentStatus,
              statusIcon: STATUS_ICONS.error,
            };
          }
          return a;
        }),
      );

      // Start metrics collection for healthy agents
      const metricsCollectors = agentInstances
        .filter((ai) => ai.status !== "error" && ai.vm)
        .map((ai) => ({
          agentId: ai.id,
          collector: startMetricsCollection(ai.vm, ai.id),
        }));

      // 4. Run all agents — stream events via onEvent callback
      await runAllAgents(agentInstances, cfg.prompt, handleEvent);
      if (disposed) return;

      // Stop metrics collection and gather results
      const metricsMap = new Map(
        metricsCollectors.map(({ agentId, collector }) => [
          agentId,
          collector.stop(),
        ]),
      );

      // Mark all agents as completed/error in UI state
      updateAgents((prev) =>
        prev.map((a) => {
          const inst = agentInstances.find((ai) => ai.id === a.id);
          const finalStatus: AgentStatus =
            inst?.status === "error" ? "error" : "completed";
          const elapsed = inst
            ? (inst.endTime ?? Date.now()) - inst.startTime
            : a.elapsedMs;
          const metrics = metricsMap.get(a.id) ?? null;
          return {
            ...a,
            status: finalStatus,
            statusIcon: STATUS_ICONS[finalStatus],
            elapsedMs: elapsed,
            currentMemory:
              metrics && metrics.snapshots.length > 0
                ? metrics.snapshots[metrics.snapshots.length - 1]!
                : a.currentMemory,
          };
        }),
      );

      // 5. Collect code and execution results
      const agentResults = await collectResults(agentInstances);
      if (disposed) return;

      // Attach metrics to results
      const resultsWithMetrics = agentResults.map((r) => ({
        ...r,
        metrics: metricsMap.get(r.agentId) ?? r.metrics,
      }));

      setResults(resultsWithMetrics);
      setPhase("completed");

      // 5.5. Write report if --output-dir is specified
      if (cfg.outputDir) {
        await writeReport(cfg.outputDir, resultsWithMetrics, agentsRef.current);
      }

      // 6. Cleanup
      await disposeAll(agentInstances);
    };

    run().catch((err) => {
      if (!disposed) {
        setError(
          `予期しないエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    return () => {
      disposed = true;
    };
  }, [handleEvent, updateAgents]);

  // ── Render ─────────────────────────────────────────────────────

  // Error state
  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          ❌ エラー
        </Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  // Initializing
  if (phase === "initializing") {
    return (
      <Box padding={1}>
        <Text>⏳ Initializing...</Text>
      </Box>
    );
  }

  // Running — show banner + progress
  if (phase === "running") {
    return (
      <Box flexDirection="column">
        {config && (
          <Banner prompt={config.prompt} agentCount={config.agentCount} />
        )}
        <ProgressView agents={agents} />
      </Box>
    );
  }

  // Completed — show banner + results
  return (
    <Box flexDirection="column">
      {config && (
        <Banner prompt={config.prompt} agentCount={config.agentCount} />
      )}
      <ResultView results={results} />
    </Box>
  );
}

export default App;
