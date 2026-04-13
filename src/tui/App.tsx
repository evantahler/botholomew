import { Box, Text } from "ink";
import React from "react";

export function App() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="blue">
        Botholomew Chat
      </Text>
      <Text dimColor>
        Chat TUI coming soon. Use the daemon and task commands for now.
      </Text>
    </Box>
  );
}
