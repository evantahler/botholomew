import { Box, Text } from "ink";

export type TabId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// Help uses "?" (no Ctrl) because Ctrl+H is delivered as backspace by most
// terminals. The other panels use Ctrl+<letter>.
const TABS: { id: TabId; label: string; key: string }[] = [
  { id: 1, label: "Chat", key: "^a" },
  { id: 2, label: "Tools", key: "^o" },
  { id: 3, label: "Context", key: "^n" },
  { id: 4, label: "Tasks", key: "^t" },
  { id: 5, label: "Threads", key: "^r" },
  { id: 6, label: "Schedules", key: "^s" },
  { id: 7, label: "Workers", key: "^w" },
  { id: 8, label: "Help", key: "?" },
];

interface TabBarProps {
  activeTab: TabId;
}

export function TabBar({ activeTab }: TabBarProps) {
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
    </Box>
  );
}
