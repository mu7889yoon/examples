import React from "react";
import { Box, Text } from "ink";
import type { AgentState } from "../types.js";

const COLUMN_WIDTH = 28;
const DEFAULT_MAX_LOG_LINES = 6;
const DEFAULT_CODE_PREVIEW_LINES = 5;

export interface AgentColumnProps {
  agent: AgentState;
}

/**
 * Extract the first N lines of code for preview display.
 */
export function extractCodePreview(
  code: string,
  maxLines: number = DEFAULT_CODE_PREVIEW_LINES
): string {
  if (!code) return "";
  const lines = code.split("\n");
  const preview = lines.slice(0, maxLines);
  return preview.join("\n");
}

/**
 * Format elapsed milliseconds as MM:SS.
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Format memory usage as "used/total MB" or "--/--" if unavailable.
 */
function formatMemory(agent: AgentState): string {
  if (!agent.currentMemory) return "Mem: --/--";
  return `Mem: ${agent.currentMemory.usedMB}/${agent.currentMemory.totalMB}MB`;
}

/**
 * Individual Agent column component for the progress display.
 */
export function AgentColumn({ agent }: AgentColumnProps) {
  const recentActivities = agent.activities.slice(-DEFAULT_MAX_LOG_LINES);

  return (
    <Box
      flexDirection="column"
      width={COLUMN_WIDTH}
      borderStyle="single"
      paddingX={1}
    >
      {/* Agent name with color */}
      <Text color={agent.color} bold>
        {agent.name}
      </Text>

      {/* Status icon + status label + elapsed time */}
      <Text>
        {agent.statusIcon} {agent.status}  {formatElapsed(agent.elapsedMs)}
      </Text>

      {/* Memory usage */}
      <Text dimColor>{formatMemory(agent)}</Text>

      {/* Separator */}
      <Text dimColor>{"─".repeat(COLUMN_WIDTH - 4)}</Text>

      {/* Activity log (most recent at bottom) */}
      <Box flexDirection="column" flexGrow={1}>
        {recentActivities.map((activity, i) => (
          <Text key={i} wrap="truncate">
            {activity.icon} {activity.summary}
          </Text>
        ))}
      </Box>

      {/* Code preview */}
      {agent.codePreview ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(COLUMN_WIDTH - 4)}</Text>
          {extractCodePreview(agent.codePreview).split("\n").map((line, i) => (
            <Text key={i} color={agent.color} dimColor wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export default AgentColumn;
