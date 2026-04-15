import { Box, Text } from "ink";
import { theme } from "../theme.ts";

/**
 * For mcp_exec calls, extract server/tool into a top-level display name
 * and strip them from the displayed input. Other tools pass through unchanged.
 */
export function resolveToolDisplay(
  name: string,
  input: string,
): { displayName: string; displayInput: string } {
  if (name !== "mcp_exec") return { displayName: name, displayInput: input };
  try {
    const parsed = JSON.parse(input);
    const server = parsed.server ?? "mcp";
    const tool = parsed.tool ?? "unknown";
    const { server: _s, tool: _t, ...rest } = parsed;
    return {
      displayName: `${server} / ${tool}`,
      displayInput: Object.keys(rest).length > 0 ? JSON.stringify(rest) : "{}",
    };
  } catch {
    return { displayName: name, displayInput: input };
  }
}

export interface LargeResultMeta {
  id: string;
  chars: number;
  pages: number;
}

export interface ToolCallData {
  name: string;
  input: string;
  output?: string;
  running: boolean;
  timestamp: Date;
  largeResult?: LargeResultMeta;
}

interface ToolCallProps {
  tool: ToolCallData;
}

export function ToolCall({ tool }: ToolCallProps) {
  const { displayName, displayInput } = resolveToolDisplay(
    tool.name,
    tool.input,
  );
  const truncatedInput =
    displayInput.length > 60 ? `${displayInput.slice(0, 60)}…` : displayInput;
  const truncatedOutput = tool.output ? tool.output.slice(0, 120) : "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={tool.running ? theme.accent : theme.muted}>
          {tool.running ? "  ⟳ " : "  ✔ "}
        </Text>
        <Text color={tool.running ? theme.accent : theme.toolName} bold>
          {displayName}
        </Text>
        {tool.name === "mcp_exec" && <Text dimColor> (exec)</Text>}
        <Text dimColor> ({truncatedInput})</Text>
      </Box>
      {truncatedOutput && !tool.running && (
        <Text dimColor wrap="truncate-end">
          {"    → "}
          {truncatedOutput}
        </Text>
      )}
      {tool.largeResult && !tool.running && (
        <Text color="yellow" wrap="truncate-end">
          {"    ⚡ "}
          Paginated for LLM [{Math.round(tool.largeResult.chars / 1000)}K,{" "}
          {tool.largeResult.pages}pg]
        </Text>
      )}
    </Box>
  );
}
