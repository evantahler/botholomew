import { Box, Text, useStdout } from "ink";
import { theme } from "../theme.ts";

interface QueuePanelProps {
  messages: string[];
  selectedIndex: number;
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1)}…`;
}

export function QueuePanel({ messages, selectedIndex }: QueuePanelProps) {
  const { stdout } = useStdout();
  const cols = (stdout?.columns ?? 80) - 8; // account for border + padding

  if (messages.length === 0) return null;

  const label = `Queue (${messages.length} pending)`;
  const hints = "Ctrl+E edit · Ctrl+X remove";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color={theme.accent} bold>
          {label}
        </Text>
        <Text dimColor>{hints}</Text>
      </Box>
      {messages.map((msg, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? "› " : "  ";
        const content = truncate(msg, cols - 4);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: queue items can be duplicates, index is the stable identity
          <Box key={i}>
            <Text
              color={isSelected ? theme.accent : undefined}
              backgroundColor={isSelected ? theme.selectionBg : undefined}
              bold={isSelected}
            >
              {prefix}
              {content}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
