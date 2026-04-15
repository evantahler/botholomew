import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { memo, useMemo, useState } from "react";
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

/** Maximum messages to render at once (performance guard) */
const MAX_RENDER = 200;

export function MessageList({
  messages,
  streamingText,
  isLoading,
  activeToolCalls,
  isActive,
}: MessageListProps) {
  // null = pinned to bottom (newest messages visible)
  // number = index of the last visible message (absolute anchor)
  const [viewEndIndex, setViewEndIndex] = useState<number | null>(null);

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

  // Compute the slice of messages to render
  const visibleMessages = useMemo(() => {
    const end = Math.min(viewEndIndex ?? messages.length, messages.length);
    const start = Math.max(0, end - MAX_RENDER);
    return messages.slice(start, end);
  }, [messages, viewEndIndex]);

  const isAtBottom = viewEndIndex === null;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      justifyContent="flex-end"
    >
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
