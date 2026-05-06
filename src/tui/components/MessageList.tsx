import { Box, Text, useStdout } from "ink";
import Spinner from "ink-spinner";
import { memo, useMemo } from "react";
import { renderMarkdown } from "../markdown.ts";
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
  streamingText: string;
  isLoading: boolean;
  activeToolCalls: ToolCallData[];
  preparingTool: { id: string; name: string } | null;
  /** Timestamp the current streaming bubble started. Stable across token flushes
   * so the displayed time doesn't flicker on every re-render. */
  streamStartedAt: Date | null;
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

export const MessageBubble = memo(function MessageBubble({
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
      <Box marginLeft={1} flexDirection="column" width={cols - 1}>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            marginBottom={0}
            width="100%"
          >
            {message.toolCalls.map((tc) => (
              <ToolCall key={tc.id} tool={tc} />
            ))}
          </Box>
        )}
        <Text>{renderedContent}</Text>
      </Box>
    </Box>
  );
});

const ActiveToolsBox = memo(function ActiveToolsBox({
  toolCalls,
}: {
  toolCalls: ToolCallData[];
}) {
  if (toolCalls.length === 0) return null;
  return (
    <Box
      flexDirection="column"
      marginLeft={1}
      borderStyle="round"
      borderColor={theme.accentBorder}
      paddingX={1}
    >
      {toolCalls.map((tc) => (
        <ToolCall key={tc.id} tool={tc} />
      ))}
    </Box>
  );
});

const StreamingMarkdown = memo(function StreamingMarkdown({
  text,
}: {
  text: string;
}) {
  const rendered = useMemo(() => renderMarkdown(text), [text]);
  return (
    <Box marginLeft={1}>
      <Text>{rendered}</Text>
    </Box>
  );
});

export function MessageList({
  streamingText,
  isLoading,
  activeToolCalls,
  preparingTool,
  streamStartedAt,
}: MessageListProps) {
  return (
    <>
      {/* Dynamic area — streaming content, managed by Ink */}
      {(streamingText || activeToolCalls.length > 0) && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold color="green">
              Botholomew
            </Text>
            <Text dimColor> {formatTime(streamStartedAt ?? new Date())}</Text>
          </Box>
          <ActiveToolsBox toolCalls={activeToolCalls} />
          {streamingText && <StreamingMarkdown text={streamingText} />}
        </Box>
      )}

      {preparingTool && (
        <Box marginTop={1}>
          <Text color={theme.accent}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor> Preparing tool call: {preparingTool.name}...</Text>
        </Box>
      )}

      {isLoading &&
        !preparingTool &&
        (activeToolCalls.length === 0 ||
          activeToolCalls.every((tc) => !tc.running)) && (
          <Box marginTop={1}>
            <Text color={theme.accent}>
              <Spinner type="dots" />
            </Text>
            <Text dimColor>
              {streamingText ? " Streaming..." : " Thinking..."}
            </Text>
          </Box>
        )}
    </>
  );
}
