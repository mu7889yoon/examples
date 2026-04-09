import React from "react";
import { Box } from "ink";
import { AgentColumn } from "./AgentColumn.js";
import type { AgentState } from "../types.js";

export interface ProgressViewProps {
  agents: AgentState[];
}

/**
 * 5-column real-time progress display.
 * Renders each agent side-by-side using a horizontal flex layout.
 */
export function ProgressView({ agents }: ProgressViewProps) {
  return (
    <Box flexDirection="row">
      {agents.map((agent) => (
        <AgentColumn key={agent.id} agent={agent} />
      ))}
    </Box>
  );
}

export default ProgressView;
