import { Box, Text, useStdout } from "ink";
import Spinner from "ink-spinner";
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
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function padLine(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  return text + " ".repeat(pad);
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
      .map((line) => padLine(` ${line}`, cols))
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

export function MessageList({
  messages,
  streamingText,
  isLoading,
  activeToolCalls,
}: MessageListProps) {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Active streaming / tool calls */}
      {(streamingText || activeToolCalls.length > 0) && (
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

      {isLoading && !streamingText && activeToolCalls.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.accent}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor> Thinking...</Text>
        </Box>
      )}
    </Box>
  );
}
