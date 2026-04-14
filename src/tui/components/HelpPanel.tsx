import { Box, Text } from "ink";

interface HelpPanelProps {
  projectDir: string;
  threadId: string;
  daemonRunning: boolean;
}

export function HelpPanel({
  projectDir,
  threadId,
  daemonRunning,
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
          {"  "}1-4{"            "}Jump to tab (non-chat tabs)
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
          Commands
        </Text>
        <Text>
          {"  "}/help{"          "}Show help in chat
        </Text>
        <Text>
          {"  "}/quit, /exit{"   "}End the chat session
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
          {"  "}Daemon{"    "}
          {daemonRunning ? (
            <Text color="green">running</Text>
          ) : (
            <Text color="red">off</Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
