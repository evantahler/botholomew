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
          {"  "}Ctrl+a{"         "}Chat
        </Text>
        <Text>
          {"  "}Ctrl+o{"         "}Tools
        </Text>
        <Text>
          {"  "}Ctrl+n{"         "}Context
        </Text>
        <Text>
          {"  "}Ctrl+t{"         "}Tasks
        </Text>
        <Text>
          {"  "}Ctrl+r{"         "}Threads
        </Text>
        <Text>
          {"  "}Ctrl+s{"         "}Schedules
        </Text>
        <Text>
          {"  "}Ctrl+w{"         "}Workers
        </Text>
        <Text>
          {"  "}?{"              "}Help (from any non-chat tab)
        </Text>
        <Text>
          {"  "}Escape{"         "}Return to Chat
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Chat
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
        <Text>
          {"  "}Esc{"            "}Steer / abort in-flight turn
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          List panels (Tools/Tasks/Threads/Schedules/Workers/Context)
        </Text>
        <Text dimColor>
          {"  "}List focus (default — dashed border on right pane):
        </Text>
        <Text>
          {"  "}↑/↓{"            "}Move list selection
        </Text>
        <Text>
          {"  "}→{"              "}Enter the right pane (border turns yellow)
        </Text>
        <Text dimColor>{"  "}Detail focus (yellow border on right pane):</Text>
        <Text>
          {"  "}↑/↓{"            "}Scroll the right pane (one line)
        </Text>
        <Text>
          {"  "}Shift+↑/↓{"      "}Page-scroll the right pane
        </Text>
        <Text>
          {"  "}g / G{"          "}Top / bottom of the right pane
        </Text>
        <Text>
          {"  "}←{"              "}Return to the list
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Context (extras)
        </Text>
        <Text>
          {"  "}→{"              "}Drill into selected folder
        </Text>
        <Text>
          {"  "}←{"              "}Go up one directory
        </Text>
        <Text>
          {"  "}/{"              "}Search context
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Per-panel actions
        </Text>
        <Text dimColor>
          {"  "}d delete needs two presses — arms first, confirms second
          (cancels on any other key or after 3s)
        </Text>
        <Text>
          {"  "}Tasks{"          "}f filter · p priority · d delete (×2) · r
          refresh
        </Text>
        <Text>
          {"  "}Threads{"        "}f filter · s/ search · w follow · d delete
          (×2) · r refresh
        </Text>
        <Text>
          {"  "}Schedules{"      "}f filter · e toggle · d delete (×2) · r
          refresh
        </Text>
        <Text>
          {"  "}Context{"        "}d delete (×2) · r refresh
        </Text>
        <Text>
          {"  "}Workers{"        "}f filter · l toggle log/detail · d delete log
          (×2, log view)
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
