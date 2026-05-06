import { Box, Text } from "ink";

export type TabId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// Help uses Ctrl+G rather than Ctrl+H because most terminals deliver Ctrl+H
// as backspace. Ctrl+G also catches the Ctrl+/ keystroke on terminals that
// map it to BEL (0x07) — most macOS terminals do.
const TABS: { id: TabId; label: string; key: string }[] = [
  { id: 1, label: "Chat", key: "^a" },
  { id: 2, label: "Tools", key: "^o" },
  { id: 3, label: "Context", key: "^n" },
  { id: 4, label: "Tasks", key: "^t" },
  { id: 5, label: "Threads", key: "^r" },
  { id: 6, label: "Schedules", key: "^s" },
  { id: 7, label: "Workers", key: "^w" },
  { id: 8, label: "Help", key: "^g" },
];

interface TabBarProps {
  activeTab: TabId;
  usage?: { used: number; max: number } | null;
}

function formatK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function TabBar({ activeTab, usage }: TabBarProps) {
  const pct =
    usage && usage.max > 0 ? Math.round((usage.used / usage.max) * 100) : null;
  const usageColor =
    pct === null
      ? undefined
      : pct >= 90
        ? "red"
        : pct >= 70
          ? "yellow"
          : "green";

  return (
    <Box paddingX={1} gap={1}>
      {TABS.map(({ id, label, key: shortcut }) => {
        const active = id === activeTab;
        return (
          <Box key={id}>
            <Text
              bold={active}
              color={active ? "cyan" : undefined}
              dimColor={!active}
              backgroundColor={active ? "#1a3a5c" : undefined}
            >
              {` ${shortcut} ${label} `}
            </Text>
          </Box>
        );
      })}
      <Box flexGrow={1} />
      {usage && (
        <Box>
          <Text color={usageColor}>
            {formatK(usage.used)}/{formatK(usage.max)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
