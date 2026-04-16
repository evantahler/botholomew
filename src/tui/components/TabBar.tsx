import { Box, Text } from "ink";

export type TabId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const TABS: { id: TabId; label: string }[] = [
  { id: 1, label: "Chat" },
  { id: 2, label: "Tools" },
  { id: 3, label: "Context" },
  { id: 4, label: "Tasks" },
  { id: 5, label: "Threads" },
  { id: 6, label: "Schedules" },
  { id: 7, label: "Help" },
];

interface TabBarProps {
  activeTab: TabId;
}

export function TabBar({ activeTab }: TabBarProps) {
  return (
    <Box paddingX={1} gap={1}>
      {TABS.map(({ id, label }) => {
        const active = id === activeTab;
        return (
          <Box key={id}>
            <Text
              bold={active}
              color={active ? "cyan" : undefined}
              dimColor={!active}
              backgroundColor={active ? "#1a3a5c" : undefined}
            >
              {` ${id} ${label} `}
            </Text>
          </Box>
        );
      })}
      <Box flexGrow={1} />
      <Text dimColor>tab to switch</Text>
    </Box>
  );
}
