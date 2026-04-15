import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { Dispatch, SetStateAction } from "react";
import { memo, useMemo } from "react";
import { theme } from "../theme.ts";
import { ToolCall, type ToolCallData } from "./ToolCall.tsx";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallData[];
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingText: string;
  isLoading: boolean;
  activeToolCalls: ToolCallData[];
  isActive: boolean;
  viewEndIndex: number | null;
  setViewEndIndex: Dispatch<SetStateAction<number | null>>;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function padLine(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  return text + " ".repeat(pad);
}

function wrapAndPad(text: string, width: number): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= width) {
      lines.push(padLine(line, width));
    } else {
      let remaining = line;
      while (remaining.length > width) {
        let breakAt = remaining.lastIndexOf(" ", width);
        if (breakAt <= 0) breakAt = width;
        lines.push(padLine(remaining.slice(0, breakAt), width));
        remaining = remaining.slice(breakAt).trimStart();
      }
      if (remaining.length > 0) {
        lines.push(padLine(remaining, width));
      }
    }
  }
  return lines.join("\n");
}

function renderMarkdown(text: string): string {
  if (!text) return "";
  return Bun.markdown.ansi(text).trimEnd();
}

/** Estimate how many terminal rows a message will occupy. */
function estimateMessageRows(msg: ChatMessage, cols: number): number {
  // marginTop(1) + header line(1)
  let rows = 2;

  // Content lines — use conservative column width for wrapping estimate
  const wrapWidth = Math.max(1, cols - 4);
  if (msg.content) {
    for (const line of msg.content.split("\n")) {
      rows += Math.max(1, Math.ceil(Math.max(1, line.length) / wrapWidth));
    }
  }

  // Tool calls: border(2) + each tool(1-3 rows)
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    rows += 2; // round border top + bottom
    for (const tc of msg.toolCalls) {
      rows += 1; // tool name + input
      if (tc.output && !tc.running) rows += 1;
      if (tc.largeResult && !tc.running) rows += 1;
    }
  }

  return rows;
}

const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: ChatMessage;
}) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const time = formatTime(message.timestamp);

  const renderedContent = useMemo(
    () =>
      message.role === "assistant" ? renderMarkdown(message.content) : null,
    [message.role, message.content],
  );

  if (message.role === "user") {
    const paddedContent = message.content
      .split("\n")
      .map((line) => wrapAndPad(` ${line}`, cols))
      .join("\n");
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text backgroundColor={theme.userBg}>
          <Text bold color="cyan">
            {" You "}
          </Text>
          <Text dimColor>{padLine(time, cols - 5)}</Text>
        </Text>
        <Text backgroundColor={theme.userBg}>{paddedContent}</Text>
      </Box>
    );
  }

  if (message.role === "system") {
    return (
      <Box marginTop={1}>
        <Text color={theme.accent} dimColor>
          ⚠ {message.content}
        </Text>
        <Text dimColor> {time}</Text>
      </Box>
    );
  }

  // assistant
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text bold color="green">
          Botholomew
        </Text>
        <Text dimColor> {time}</Text>
      </Box>
      <Box marginLeft={1} flexDirection="column">
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            marginBottom={0}
          >
            {message.toolCalls.map((tc) => (
              <ToolCall key={`${tc.name}-${tc.input.slice(0, 20)}`} tool={tc} />
            ))}
          </Box>
        )}
        <Text>{renderedContent}</Text>
      </Box>
    </Box>
  );
});

/** Rows used by fixed chrome (tab bar, divider, input bar + status bar). */
const CHROME_ROWS = 6;

export function MessageList({
  messages,
  streamingText,
  isLoading,
  activeToolCalls,
  isActive,
  viewEndIndex,
  setViewEndIndex,
}: MessageListProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;

  // Scroll input — Shift+↑/↓
  useInput((_input, key) => {
    if (!isActive) return;

    if (key.shift && key.upArrow) {
      setViewEndIndex((current) => {
        const end = current ?? messages.length;
        return Math.max(1, end - 3);
      });
    }
    if (key.shift && key.downArrow) {
      setViewEndIndex((current) => {
        if (current === null) return null;
        const newEnd = current + 3;
        return newEnd >= messages.length ? null : newEnd;
      });
    }
  });

  const isAtBottom = viewEndIndex === null;
  const hasActiveContent =
    streamingText.length > 0 || activeToolCalls.length > 0;

  // Build visible messages that fit within the available terminal rows.
  // This replaces overflow="hidden" + justifyContent="flex-end" which caused
  // Ink to recalculate clipping on every re-render, producing visual jumps.
  const visibleMessages = useMemo(() => {
    const endIdx = Math.min(viewEndIndex ?? messages.length, messages.length);

    let budget = Math.max(5, termRows - CHROME_ROWS);

    // Reserve rows for the bottom section (streaming, spinner, or indicator)
    if (!isAtBottom) {
      budget -= 1; // scroll indicator
    } else if (hasActiveContent) {
      budget -= 6; // streaming header + tool calls + text
    } else if (isLoading) {
      budget -= 2; // spinner
    }

    let startIdx = endIdx;
    while (startIdx > 0 && budget > 0) {
      startIdx--;
      const msg = messages[startIdx];
      if (msg) budget -= estimateMessageRows(msg, cols);
    }

    // If the last message pushed us over budget, drop it (keep at least one)
    if (budget < 0 && startIdx < endIdx - 1) startIdx++;

    return messages.slice(startIdx, endIdx);
  }, [
    messages,
    viewEndIndex,
    termRows,
    cols,
    isAtBottom,
    hasActiveContent,
    isLoading,
  ]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Spacer pushes content to the bottom without relying on flex-end */}
      <Box flexGrow={1} />

      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Active streaming / tool calls — only shown when pinned to bottom */}
      {isAtBottom && (streamingText || activeToolCalls.length > 0) && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold color="green">
              Botholomew
            </Text>
            <Text dimColor> {formatTime(new Date())}</Text>
          </Box>
          {activeToolCalls.length > 0 && (
            <Box
              flexDirection="column"
              marginLeft={1}
              borderStyle="round"
              borderColor={theme.accentBorder}
              paddingX={1}
            >
              {activeToolCalls.map((tc) => (
                <ToolCall key={`active-${tc.name}`} tool={tc} />
              ))}
            </Box>
          )}
          {streamingText && (
            <Box marginLeft={1}>
              <Text>{renderMarkdown(streamingText)}</Text>
            </Box>
          )}
        </Box>
      )}

      {isAtBottom &&
        isLoading &&
        !streamingText &&
        (activeToolCalls.length === 0 ||
          activeToolCalls.every((tc) => !tc.running)) && (
          <Box marginTop={1}>
            <Text color={theme.accent}>
              <Spinner type="dots" />
            </Text>
            <Text dimColor> Thinking...</Text>
          </Box>
        )}

      {/* Scroll indicator */}
      {!isAtBottom && (
        <Box justifyContent="center">
          <Text dimColor>
            ↓ {messages.length - (viewEndIndex ?? messages.length)} more —
            Shift+↓ to scroll down
          </Text>
        </Box>
      )}
    </Box>
  );
}
