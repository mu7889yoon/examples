import React from "react";
import { Box, Text } from "ink";

interface BannerProps {
  prompt: string;
  agentCount: number;
}

export function Banner({ prompt, agentCount }: BannerProps) {
  const title = "🤖 Parallel FizzBuzz Agents";
  const promptLine = `Prompt: ${prompt}`;
  const agentsLine = `Agents: ${agentCount}`;

  const contentWidth = Math.max(
    title.length,
    promptLine.length,
    agentsLine.length
  );
  // Add padding on each side
  const innerWidth = contentWidth + 2;

  const top = `╔${"═".repeat(innerWidth)}╗`;
  const bottom = `╚${"═".repeat(innerWidth)}╝`;

  const pad = (text: string) => {
    // Visual width approximation: emoji takes ~2 chars width
    const padded = text.padEnd(contentWidth);
    return `║ ${padded} ║`;
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan">{top}</Text>
      <Text color="cyan">{pad(title)}</Text>
      <Text color="cyan">{pad(promptLine)}</Text>
      <Text color="cyan">{pad(agentsLine)}</Text>
      <Text color="cyan">{bottom}</Text>
    </Box>
  );
}

export default Banner;
