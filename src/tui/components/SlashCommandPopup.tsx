import { Box, Text } from "ink";
import { memo } from "react";
import type { SlashCommand } from "../../skills/commands.ts";

interface SlashCommandPopupProps {
  matches: SlashCommand[];
  selectedIndex: number;
}

export const SlashCommandPopup = memo(function SlashCommandPopup({
  matches,
  selectedIndex,
}: SlashCommandPopupProps) {
  if (matches.length === 0) return null;

  const nameWidth = matches.reduce(
    (max, c) => Math.max(max, c.name.length + 1),
    0,
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      {matches.map((cmd, i) => {
        const active = i === selectedIndex;
        const marker = active ? "›" : " ";
        const padded = `/${cmd.name}`.padEnd(nameWidth + 1);
        return (
          <Box key={cmd.name}>
            <Text color={active ? "green" : undefined} bold={active}>
              {marker} {padded}
            </Text>
            <Text dimColor={!active}>
              {cmd.description || "(no description)"}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={0}>
        <Text dimColor>
          ↑↓ to navigate · tab/return to accept · esc to close
        </Text>
      </Box>
    </Box>
  );
});
