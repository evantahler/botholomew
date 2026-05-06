import { Box, Text } from "ink";
import { memo } from "react";
import type { ContextUsage } from "../../chat/usage.ts";

interface HelpPanelProps {
  projectDir: string;
  threadId: string;
  workerRunning: boolean;
  usage?: ContextUsage | null;
}

function formatK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function usageColorFor(pct: number): "red" | "yellow" | "green" {
  if (pct >= 90) return "red";
  if (pct >= 70) return "yellow";
  return "green";
}

export const HelpPanel = memo(function HelpPanel({
  projectDir,
  threadId,
  workerRunning,
  usage,
}: HelpPanelProps) {
  const pct =
    usage && usage.max > 0 ? Math.round((usage.used / usage.max) * 100) : null;
  const breakdownRows: { label: string; tokens: number }[] = usage
    ? [
        { label: "Prompts (files)", tokens: usage.breakdown.prompts },
        { label: "Instructions   ", tokens: usage.breakdown.instructions },
        { label: "Tools          ", tokens: usage.breakdown.tools },
        { label: "Messages       ", tokens: usage.breakdown.messages },
        { label: "Tool I/O       ", tokens: usage.breakdown.toolIo },
      ]
    : [];
  const breakdownTotal = breakdownRows.reduce((s, r) => s + r.tokens, 0);
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
          {"  "}Ctrl+g{"        "}Help (Ctrl+/ also works in most terminals)
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
        <Text>
          {"  "}Tasks{"          "}f filter · p priority · d delete · r refresh
        </Text>
        <Text>
          {"  "}Threads{"        "}f filter · s/ search · w follow · d delete ·
          r refresh
        </Text>
        <Text>
          {"  "}Schedules{"      "}f filter · e toggle · d delete · r refresh
        </Text>
        <Text>
          {"  "}Workers{"        "}f filter · l toggle log/detail
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
          Context usage
        </Text>
        {usage && pct !== null ? (
          <>
            <Text>
              {"  "}Total{"     "}
              <Text color={usageColorFor(pct)}>
                {formatK(usage.used)}/{formatK(usage.max)} ({pct}%)
              </Text>
            </Text>
            <Text dimColor>
              {"  "}Estimate (~4 chars/token, sums to ~{formatK(breakdownTotal)}
              ):
            </Text>
            {breakdownRows.map((row) => (
              <Text key={row.label}>
                {"    "}
                {row.label}
                {"  "}
                {formatK(row.tokens)}
              </Text>
            ))}
          </>
        ) : (
          <Text dimColor>
            {"  "}Send a message to see token usage for the next turn.
          </Text>
        )}
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
