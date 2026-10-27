import { Box, Text, useInput } from "ink";
import { memo, useEffect, useMemo, useState } from "react";
import {
  detailPaneBorderProps,
  type FocusState,
  handleListDetailKey,
} from "../listDetailKeys.ts";
import { ansi, theme } from "../theme.ts";
import { useLatestRef } from "../useLatestRef.ts";
import { useTerminalSize } from "../useTerminalSize.ts";
import { wrapDetailLines } from "../wrapDetail.ts";
import { Scrollbar } from "./Scrollbar.tsx";
import { resolveToolDisplay, type ToolCallData } from "./ToolCall.tsx";

interface ToolPanelProps {
  toolCalls: ToolCallData[];
  isActive: boolean;
}

const SIDEBAR_WIDTH = 42;

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
  if (value === null) return `${ansi.toolName}null${ansi.reset}`;
  if (typeof value === "boolean")
    return `${ansi.toolName}${value ? "true" : "false"}${ansi.reset}`;
  if (typeof value === "number") return `${ansi.accent}${value}${ansi.reset}`;
  if (typeof value === "string") {
    // Try to unwrap stringified JSON (common in tool results)
    const inner = tryParseJson(value);
    if (inner !== undefined && typeof inner === "object" && inner !== null) {
      return colorizeValue(inner, indent);
    }
    const escaped = JSON.stringify(value);
    return `${ansi.success}${escaped}${ansi.reset}`;
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
        `${innerPad}${ansi.info}${JSON.stringify(k)}${ansi.reset}: ${colorizeValue(v, indent + 1)}`,
    );
    return `{\n${lines.join(",\n")}\n${pad}}`;
  }

  return String(value);
}

function buildDetailAnsi(tool: ToolCallData): string {
  const lines: string[] = [];

  const { displayInput } = resolveToolDisplay(tool.name, tool.input);

  // Body only — name/server/status/time live in the panel header now.
  lines.push(`${ansi.bold}${ansi.primary}Input${ansi.reset}`);
  lines.push(colorizeJson(displayInput));
  lines.push("");

  if (tool.output) {
    if (tool.isError) {
      lines.push(`${ansi.bold}${ansi.error}Error${ansi.reset}`);
      lines.push(`${ansi.error}${colorizeJson(tool.output)}${ansi.reset}`);
    } else {
      lines.push(`${ansi.bold}${ansi.primary}Output${ansi.reset}`);
      if (tool.largeResult) {
        lines.push(
          `${ansi.accent}Paginated for LLM: ${tool.largeResult.chars.toLocaleString()} chars, ${tool.largeResult.pages} page(s) — stored as ${tool.largeResult.id}${ansi.reset}`,
        );
      }
      lines.push(colorizeJson(tool.output));
    }
  } else if (!tool.running) {
    lines.push(`${ansi.bold}${ansi.primary}Output${ansi.reset}`);
    lines.push(`${ansi.dim}(no output)${ansi.reset}`);
  }

  return lines.join("\n");
}

const PAGE_SCROLL_LINES = 10;

export const ToolPanel = memo(function ToolPanel({
  toolCalls,
  isActive,
}: ToolPanelProps) {
  const { rows: termRows, cols: termCols } = useTerminalSize();
  // Detail-pane content width: total cols minus sidebar, minus 4 chars of
  // border+padding on the right pane, minus 1 col for the scrollbar.
  const detailWidth = Math.max(1, termCols - SIDEBAR_WIDTH - 5);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<FocusState>("list");

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
    () => wrapDetailLines(renderedDetail, detailWidth),
    [renderedDetail, detailWidth],
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

  const itemCountRef = useLatestRef(reversedCalls.length);
  const maxDetailScrollRef = useLatestRef(maxDetailScroll);
  const focusRef = useLatestRef(focus);

  useInput(
    (input, key) => {
      handleListDetailKey(input, key, {
        focusRef,
        setFocus,
        itemCountRef,
        maxDetailScrollRef,
        setSelectedIndex,
        setDetailScroll,
        pageScrollLines: PAGE_SCROLL_LINES,
      });
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
          const icon = tc.running ? "⟳" : tc.isError ? "✘" : "✔";
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
            <Box key={tc.id} paddingX={1}>
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
                  color={
                    tc.running
                      ? theme.accent
                      : tc.isError
                        ? theme.error
                        : theme.muted
                  }
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
        {...detailPaneBorderProps(focus)}
        overflow="hidden"
      >
        {selectedTool && <ToolDetailHeader tool={selectedTool} />}
        <Box flexDirection="row" flexGrow={1} overflow="hidden">
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {detailVisible.map((line, i) => {
              const lineNum = detailScroll + i;
              return (
                <Text key={lineNum} wrap="truncate-end">
                  {line || " "}
                </Text>
              );
            })}
          </Box>
          <Scrollbar
            total={detailLines.length}
            visible={visibleRows - 3}
            offset={detailScroll}
            height={visibleRows - 3}
            focused={focus === "detail"}
          />
        </Box>
        <Text dimColor>
          {focus === "detail"
            ? "↑↓ scroll · ⇧↑↓ page · g/G top/bot · ← back to list"
            : "↑↓ select · → enter detail"}
        </Text>
      </Box>
    </Box>
  );
});

function ToolDetailHeader({ tool }: { tool: ToolCallData }) {
  const { displayName } = resolveToolDisplay(tool.name, tool.input);
  const time = tool.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const isMcp = tool.name === "mcp_exec";
  const status = tool.running
    ? { color: theme.accent, label: "⟳ running" }
    : tool.isError
      ? { color: theme.error, label: "✘ error" }
      : tool.output
        ? { color: theme.success, label: "✔ done" }
        : { color: theme.muted, label: "— no output" };
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={theme.info} wrap="truncate-end">
          {displayName}
        </Text>
      </Box>
      <Box>
        <Text wrap="truncate-end">
          <Text dimColor>{isMcp ? "mcp_exec · " : ""}</Text>
          <Text color={status.color}>{status.label}</Text>
          <Text dimColor> · {time}</Text>
        </Text>
      </Box>
      <Box>
        <Text dimColor>{"─".repeat(2)}</Text>
      </Box>
    </Box>
  );
}
