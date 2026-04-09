import React from "react";
import { Box, Text } from "ink";
import type { AgentResult } from "../types.js";

const COLUMN_WIDTH = 28;
const CODE_MAX_LINES = 10;
const STDOUT_MAX_LINES = 10;

export interface ResultViewProps {
  results: AgentResult[];
}

/**
 * Truncate multi-line text to a maximum number of lines.
 * Appends "..." if truncated.
 */
function truncateLines(text: string, maxLines: number): string[] {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), "..."];
}

/**
 * Format memory value in MB, or "N/A" if null.
 */
function formatMB(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${Math.round(value)}MB`;
}

/**
 * Single result column showing agent name, language, code, stdout, error, and metrics.
 */
function ResultColumn({ result }: { result: AgentResult }) {
  const hasError = result.error != null;
  const hasCode = result.code != null && result.code.length > 0;
  const hasStdout = result.stdout != null && result.stdout.length > 0;
  const hasMetrics = result.metrics != null;

  return (
    <Box
      flexDirection="column"
      width={COLUMN_WIDTH}
      borderStyle="double"
      paddingX={1}
    >
      {/* Header: Agent name + language */}
      <Text bold>{result.agentName}</Text>
      <Text dimColor>
        {hasError ? "(Error)" : result.language ?? "Unknown"}
      </Text>

      {/* Separator */}
      <Text dimColor>{"═".repeat(COLUMN_WIDTH - 4)}</Text>

      {/* Code section */}
      <Box flexDirection="column" minHeight={3}>
        {hasError ? (
          <Text color="red">❌ {result.error}</Text>
        ) : hasCode ? (
          truncateLines(result.code!, CODE_MAX_LINES).map((line, i) => (
            <Text key={i} wrap="truncate">
              {line}
            </Text>
          ))
        ) : (
          <Text dimColor>No code</Text>
        )}
      </Box>

      {/* Separator */}
      <Text dimColor>{"═".repeat(COLUMN_WIDTH - 4)}</Text>

      {/* Stdout section */}
      <Box flexDirection="column" minHeight={2}>
        {hasStdout ? (
          truncateLines(result.stdout!, STDOUT_MAX_LINES).map((line, i) => (
            <Text key={i} wrap="truncate">
              {line}
            </Text>
          ))
        ) : (
          <Text dimColor>{hasError ? "" : "No output"}</Text>
        )}
      </Box>

      {/* Separator */}
      <Text dimColor>{"═".repeat(COLUMN_WIDTH - 4)}</Text>

      {/* VM Metrics section */}
      {hasMetrics ? (
        <Box flexDirection="column">
          <Text>Peak: {formatMB(result.metrics!.peakUsedMB)}</Text>
          <Text>Avg:  {formatMB(result.metrics!.avgUsedMB)}</Text>
        </Box>
      ) : (
        <Text dimColor>N/A</Text>
      )}
    </Box>
  );
}

/**
 * Result comparison view displayed after all agents complete.
 * Shows each agent's code, language, execution result, error messages,
 * and VM metrics side by side.
 */
export function ResultView({ results }: ResultViewProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>═══ Results ═══</Text>
      </Box>
      <Box flexDirection="row">
        {results.map((result) => (
          <ResultColumn key={result.agentId} result={result} />
        ))}
      </Box>
    </Box>
  );
}

export default ResultView;
