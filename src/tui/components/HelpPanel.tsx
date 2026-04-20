import { Box, Text } from "ink";
import { memo } from "react";

interface HelpPanelProps {
  projectDir: string;
  threadId: string;
  workerRunning: boolean;
}

export const HelpPanel = memo(function HelpPanel({
  projectDir,
  threadId,
  workerRunning,
}: HelpPanelProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Navigation
        </Text>
        <Text>
          {"  "}Tab{"            "}Cycle between tabs
        </Text>
        <Text>
          {"  "}1-6{"            "}Jump to tab (non-chat tabs)
        </Text>
        <Text>
          {"  "}Escape{"         "}Return to Chat tab
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Chat (Tab 1)
        </Text>
        <Text>
          {"  "}Enter{"          "}Send message
        </Text>
        <Text>
          {"  "}⌥+Enter{"        "}Insert newline
        </Text>
        <Text>
          {"  "}↑/↓{"            "}Browse input history
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Tools (Tab 2)
        </Text>
        <Text>
          {"  "}↑/↓{"            "}Select tool call
        </Text>
        <Text>
          {"  "}Shift+↑/↓{"      "}Scroll detail pane
        </Text>
        <Text>
          {"  "}j / k{"          "}Scroll detail pane
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Context (Tab 3)
        </Text>
        <Text>
          {"  "}↑/↓{"            "}Navigate items
        </Text>
        <Text>
          {"  "}Enter{"          "}Expand directory / preview file
        </Text>
        <Text>
          {"  "}Backspace{"      "}Go up one directory
        </Text>
        <Text>
          {"  "}/{"              "}Search context
        </Text>
        <Text>
          {"  "}d{"              "}Delete selected item (with confirmation)
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Tasks (Tab 4)
        </Text>
        <Text>
          {"  "}↑/↓{"            "}Navigate task list
        </Text>
        <Text>
          {"  "}Shift+↑/↓{"      "}Scroll detail pane
        </Text>
        <Text>
          {"  "}j / k{"          "}Scroll detail pane
        </Text>
        <Text>
          {"  "}f{"              "}Cycle status filter
        </Text>
        <Text>
          {"  "}p{"              "}Cycle priority filter
        </Text>
        <Text>
          {"  "}r{"              "}Refresh tasks
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Threads (Tab 5)
        </Text>
        <Text>
          {"  "}↑/↓{"            "}Navigate thread list
        </Text>
        <Text>
          {"  "}Shift+↑/↓{"      "}Scroll detail pane
        </Text>
        <Text>
          {"  "}j / k{"          "}Scroll detail pane
        </Text>
        <Text>
          {"  "}f{"              "}Cycle type filter
        </Text>
        <Text>
          {"  "}d{"              "}Delete thread (with confirmation)
        </Text>
        <Text>
          {"  "}r{"              "}Refresh threads
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Commands
        </Text>
        <Text>
          {"  "}/help{"          "}Show help in chat
        </Text>
        <Text>
          {"  "}/exit{"          "}End the chat session
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          System Info
        </Text>
        <Text>
          {"  "}Project{"   "}
          {projectDir}
        </Text>
        <Text>
          {"  "}Thread{"    "}
          {threadId}
        </Text>
        <Text>
          {"  "}Workers{"   "}
          {workerRunning ? (
            <Text color="green">running</Text>
          ) : (
            <Text color="yellow">none</Text>
          )}
        </Text>
      </Box>
    </Box>
  );
});
