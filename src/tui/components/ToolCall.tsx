import { Box, Text } from "ink";
import { theme } from "../theme.ts";

export interface ToolCallData {
  name: string;
  input: string;
  output?: string;
  running: boolean;
}

interface ToolCallProps {
  tool: ToolCallData;
}

export function ToolCall({ tool }: ToolCallProps) {
  const truncatedInput =
    tool.input.length > 60 ? `${tool.input.slice(0, 60)}…` : tool.input;
  const truncatedOutput = tool.output ? tool.output.slice(0, 120) : "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={tool.running ? theme.accent : theme.muted}>
          {tool.running ? "  ⟳ " : "  ✔ "}
        </Text>
        <Text color={tool.running ? theme.accent : theme.toolName} bold>
          {tool.name}
        </Text>
        <Text dimColor> ({truncatedInput})</Text>
      </Box>
      {truncatedOutput && !tool.running && (
        <Text dimColor wrap="truncate-end">
          {"    → "}
          {truncatedOutput}
        </Text>
      )}
    </Box>
  );
}
