import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  // scrollBack: number of messages hidden below the viewport.
  // 0 means "pinned to bottom" (newest messages visible).
  const [scrollBack, setScrollBack] = useState(0);
  const prevLen = useRef(messages.length);

  // When new messages arrive and we're pinned to bottom, stay there.
  // When new messages arrive and we're scrolled up, hold position by
  // increasing scrollBack so the same messages stay in view.
  useEffect(() => {
    const added = messages.length - prevLen.current;
    if (added > 0 && scrollBack > 0) {
      setScrollBack((sb) => sb + added);
    }
    prevLen.current = messages.length;
  }, [messages.length, scrollBack]);

  // Scroll input — Shift+↑/↓
  useInput((_input, key) => {
    if (!isActive) return;

    if (key.shift && key.upArrow) {
      setScrollBack((sb) => Math.min(sb + 3, Math.max(0, messages.length - 1)));
    }
    if (key.shift && key.downArrow) {
      setScrollBack((sb) => Math.max(sb - 3, 0));
    }
  });

  // Compute the slice of messages to render
  const visibleMessages = useMemo(() => {
    if (scrollBack === 0) {
      // Pinned to bottom — show last MAX_RENDER messages
      return messages.slice(-MAX_RENDER);
    }
    const end = messages.length - scrollBack;
    const start = Math.max(0, end - MAX_RENDER);
    return messages.slice(start, Math.max(0, end));
  }, [messages, scrollBack]);

  const isAtBottom = scrollBack === 0;

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
          <Text dimColor>↓ {scrollBack} more — Shift+↓ to scroll down</Text>
        </Box>
      )}
    </Box>
  );
}
