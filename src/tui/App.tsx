import React from "react";
import { Text, Box } from "ink";

export function App() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="blue">
        Botholomew Chat
      </Text>
      <Text dimColor>Chat TUI coming soon. Use the daemon and task commands for now.</Text>
    </Box>
  );
}
