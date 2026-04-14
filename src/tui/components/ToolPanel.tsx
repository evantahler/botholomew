import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
import { theme } from "../theme.ts";
import { resolveToolDisplay, type ToolCallData } from "./ToolCall.tsx";

interface ToolPanelProps {
  toolCalls: ToolCallData[];
  isActive: boolean;
}

const SIDEBAR_WIDTH = 42;

// ANSI escape helpers
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";

/** Try to parse a string as JSON; returns the parsed value or undefined on failure */
function tryParseJson(str: string): unknown | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

/** Colorize a JSON string with ANSI codes */
function colorizeJson(str: string): string {
  const parsed = tryParseJson(str);
  if (parsed === undefined) return str;
  return colorizeValue(parsed, 0);
}

function colorizeValue(value: unknown, indent: number): string {
  if (value === null) return `${MAGENTA}null${RESET}`;
  if (typeof value === "boolean")
    return `${MAGENTA}${value ? "true" : "false"}${RESET}`;
  if (typeof value === "number") return `${YELLOW}${value}${RESET}`;
  if (typeof value === "string") {
    // Try to unwrap stringified JSON (common in tool results)
    const inner = tryParseJson(value);
    if (inner !== undefined && typeof inner === "object" && inner !== null) {
      return colorizeValue(inner, indent);
    }
    const escaped = JSON.stringify(value);
    return `${GREEN}${escaped}${RESET}`;
  }

  const pad = "  ".repeat(indent);
  const innerPad = "  ".repeat(indent + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map(
      (v) => `${innerPad}${colorizeValue(v, indent + 1)}`,
    );
    return `[\n${items.join(",\n")}\n${pad}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const lines = entries.map(
      ([k, v]) =>
        `${innerPad}${CYAN}${JSON.stringify(k)}${RESET}: ${colorizeValue(v, indent + 1)}`,
    );
    return `{\n${lines.join(",\n")}\n${pad}}`;
  }

  return String(value);
}

function buildDetailAnsi(tool: ToolCallData): string {
  const lines: string[] = [];

  const time = tool.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const { displayName, displayInput } = resolveToolDisplay(
    tool.name,
    tool.input,
  );
  lines.push(`${BOLD}${CYAN}${displayName}${RESET}`);
  if (tool.name === "mcp_exec") {
    lines.push(`${DIM}via mcp_exec${RESET}`);
  }
  lines.push(`${DIM}Time: ${time}${RESET}`);
  if (tool.running) {
    lines.push(`${YELLOW}⟳ running${RESET}`);
  }
  lines.push("");

  lines.push(`${BOLD}${BLUE}Input${RESET}`);
  lines.push(colorizeJson(displayInput));
  lines.push("");

  if (tool.output) {
    lines.push(`${BOLD}${BLUE}Output${RESET}`);
    lines.push(colorizeJson(tool.output));
  } else if (!tool.running) {
    lines.push(`${BOLD}${BLUE}Output${RESET}`);
    lines.push(`${DIM}(no output)${RESET}`);
  }

  return lines.join("\n");
}

const PAGE_SCROLL_LINES = 10;

export function ToolPanel({ toolCalls, isActive }: ToolPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);

  // Reverse-chronological order (most recent first)
  const reversedCalls = useMemo(() => [...toolCalls].reverse(), [toolCalls]);

  // Keep selection in bounds when new calls arrive
  useEffect(() => {
    if (selectedIndex >= reversedCalls.length && reversedCalls.length > 0) {
      setSelectedIndex(reversedCalls.length - 1);
    }
  }, [reversedCalls.length, selectedIndex]);

  const selectedTool = reversedCalls[selectedIndex];

  const renderedDetail = useMemo(() => {
    if (!selectedTool) return "";
    return buildDetailAnsi(selectedTool);
  }, [selectedTool]);

  const detailLines = useMemo(
    () => renderedDetail.split("\n"),
    [renderedDetail],
  );

  // Visible area for sidebar and detail
  const visibleRows = Math.max(1, termRows - 6); // chrome: tab bar, divider, status, input, borders
  const maxDetailScroll = Math.max(0, detailLines.length - visibleRows);
  const sidebarScrollOffset = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleRows / 2),
      reversedCalls.length - visibleRows,
    ),
  );

  // Reset detail scroll when selection changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex is the intentional trigger
  useEffect(() => {
    setDetailScroll(0);
  }, [selectedIndex]);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        if (key.shift) {
          // Shift+up scrolls detail
          setDetailScroll((s) => Math.max(0, s - 1));
        } else {
          setSelectedIndex((i) => Math.max(0, i - 1));
        }
        return;
      }
      if (key.downArrow) {
        if (key.shift) {
          setDetailScroll((s) => Math.min(maxDetailScroll, s + 1));
        } else {
          setSelectedIndex((i) => Math.min(reversedCalls.length - 1, i + 1));
        }
        return;
      }

      // j/k vim-style for detail scrolling (single line)
      if (input === "j") {
        setDetailScroll((s) => Math.min(maxDetailScroll, s + 1));
        return;
      }
      if (input === "k") {
        setDetailScroll((s) => Math.max(0, s - 1));
        return;
      }

      // J/K for page scrolling (hold shift or caps)
      if (input === "J") {
        setDetailScroll((s) =>
          Math.min(maxDetailScroll, s + PAGE_SCROLL_LINES),
        );
        return;
      }
      if (input === "K") {
        setDetailScroll((s) => Math.max(0, s - PAGE_SCROLL_LINES));
        return;
      }

      // g/G for top/bottom
      if (input === "g") {
        setDetailScroll(0);
        return;
      }
      if (input === "G") {
        setDetailScroll(maxDetailScroll);
        return;
      }
    },
    { isActive },
  );

  if (reversedCalls.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>
          No tool calls to inspect yet. Tool calls will appear here as the agent
          uses them.
        </Text>
      </Box>
    );
  }

  // Sidebar visible window
  const sidebarVisible = reversedCalls.slice(
    sidebarScrollOffset,
    sidebarScrollOffset + visibleRows,
  );

  // Detail visible window
  const detailVisible = detailLines.slice(
    detailScroll,
    detailScroll + visibleRows,
  );

  return (
    <Box flexGrow={1} height={visibleRows + 1} overflow="hidden">
      {/* Left sidebar: tool call list */}
      <Box
        flexDirection="column"
        width={SIDEBAR_WIDTH}
        height={visibleRows + 1}
        borderStyle="single"
        borderColor={theme.muted}
        borderRight
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        overflow="hidden"
      >
        <Box paddingX={1}>
          <Text bold dimColor>
            Tool Calls ({reversedCalls.length})
          </Text>
        </Box>
        {sidebarVisible.map((tc, vi) => {
          const i = vi + sidebarScrollOffset;
          const isSelected = i === selectedIndex;
          const icon = tc.running ? "⟳" : "✔";
          const time = tc.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const { displayName } = resolveToolDisplay(tc.name, tc.input);
          const maxName = SIDEBAR_WIDTH - 12; // icon + time + padding
          const nameDisplay =
            displayName.length > maxName
              ? `${displayName.slice(0, maxName - 1)}…`
              : displayName;
          return (
            <Box key={`${i}-${tc.name}`} paddingX={1}>
              <Text
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                bold={isSelected}
                color={
                  isSelected
                    ? theme.info
                    : tc.running
                      ? theme.accent
                      : undefined
                }
                wrap="truncate-end"
              >
                {isSelected ? "▸" : " "}{" "}
                <Text
                  color={tc.running ? theme.accent : theme.muted}
                  bold={false}
                >
                  {icon}
                </Text>{" "}
                {nameDisplay}
                <Text dimColor> {time}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Right detail pane */}
      <Box
        flexDirection="column"
        flexGrow={1}
        height={visibleRows + 1}
        paddingX={1}
        overflow="hidden"
      >
        {detailVisible.map((line, i) => {
          const lineNum = detailScroll + i;
          return <Text key={lineNum}>{line || " "}</Text>;
        })}
        {detailLines.length > visibleRows && (
          <Box>
            <Text dimColor>
              ↑↓ select · j/k scroll · J/K page · g/G top/bottom · [
              {detailScroll + 1}–
              {Math.min(detailScroll + visibleRows, detailLines.length)} of{" "}
              {detailLines.length}]
            </Text>
          </Box>
        )}
        {detailLines.length <= visibleRows && <Box flexGrow={1} />}
        {detailLines.length <= visibleRows && (
          <Text dimColor>↑↓ select tool calls</Text>
        )}
      </Box>
    </Box>
  );
}
