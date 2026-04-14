import { Box, Text, useApp } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatSession,
  endChatSession,
  sendMessage,
  startChatSession,
} from "../chat/session.ts";
import type { Interaction } from "../db/threads.ts";
import { getThread } from "../db/threads.ts";
import { InputBar } from "./components/InputBar.tsx";
import { type ChatMessage, MessageList } from "./components/MessageList.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import type { ToolCallData } from "./components/ToolCall.tsx";

interface AppProps {
  projectDir: string;
  threadId?: string;
}

let nextMsgId = 0;
function msgId(): string {
  return `msg-${++nextMsgId}`;
}

function restoreMessagesFromInteractions(
  interactions: Interaction[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  let pendingTools: ToolCallData[] = [];

  for (const ix of interactions) {
    if (ix.kind === "tool_use") {
      pendingTools.push({
        name: ix.tool_name ?? "unknown",
        input: ix.tool_input ?? "{}",
        running: false,
      });
    } else if (ix.kind === "tool_result") {
      // Attach output to the matching pending tool call
      const tc = pendingTools.find((t) => t.name === ix.tool_name && !t.output);
      if (tc) {
        tc.output = ix.content;
      }
    } else if (ix.kind === "message" && ix.role === "user") {
      result.push({
        id: msgId(),
        role: "user",
        content: ix.content,
        timestamp: ix.created_at,
      });
    } else if (ix.kind === "message" && ix.role === "assistant") {
      result.push({
        id: msgId(),
        role: "assistant",
        content: ix.content,
        timestamp: ix.created_at,
        toolCalls: pendingTools.length > 0 ? [...pendingTools] : undefined,
      });
      pendingTools = [];
    }
  }

  // If there are leftover tool calls with no following assistant message
  if (pendingTools.length > 0) {
    result.push({
      id: msgId(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      toolCalls: [...pendingTools],
    });
  }

  return result;
}

export function App({ projectDir, threadId: resumeThreadId }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallData[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  // Initialize session
  useEffect(() => {
    let cancelled = false;

    startChatSession(projectDir, resumeThreadId)
      .then(async (session) => {
        if (cancelled) {
          endChatSession(session);
          return;
        }
        sessionRef.current = session;

        // If resuming, populate the message list from DB interactions
        if (session.messages.length > 0) {
          const threadData = await getThread(session.conn, session.threadId);
          if (threadData) {
            setMessages(
              restoreMessagesFromInteractions(threadData.interactions),
            );
          }
        }

        setReady(true);
      })
      .catch((err) => {
        setError(`Failed to start session: ${err}`);
      });

    return () => {
      cancelled = true;
      if (sessionRef.current) {
        const threadId = sessionRef.current.threadId;
        endChatSession(sessionRef.current);
        process.stderr.write(
          `\nThread: ${threadId}\nResume with: \x1b[32mbotholomew chat --thread-id ${threadId}\x1b[0m\n`,
        );
      }
    };
  }, [projectDir, resumeThreadId]);

  const processQueue = useCallback(async () => {
    if (processingRef.current || !sessionRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const trimmed = queueRef.current.shift();
      if (!trimmed) break;
      setIsLoading(true);
      setStreamingText("");
      setActiveToolCalls([]);

      // Add user message
      const userMsg: ChatMessage = {
        id: msgId(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Collect tool calls for the current segment
      let pendingToolCalls: ToolCallData[] = [];
      let currentText = "";

      const finalizeSegment = () => {
        if (currentText || pendingToolCalls.length > 0) {
          const assistantMsg: ChatMessage = {
            id: msgId(),
            role: "assistant",
            content: currentText,
            timestamp: new Date(),
            toolCalls:
              pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
          };
          setMessages((prev) => [...prev, assistantMsg]);
          currentText = "";
          pendingToolCalls = [];
          setStreamingText("");
          setActiveToolCalls([]);
        }
      };

      try {
        await sendMessage(sessionRef.current, trimmed, {
          onToken: (token) => {
            currentText += token;
            setStreamingText(currentText);
          },
          onToolStart: (name, input) => {
            if (currentText) {
              finalizeSegment();
            }
            const tc: ToolCallData = { name, input, running: true };
            pendingToolCalls.push(tc);
            setActiveToolCalls([...pendingToolCalls]);
          },
          onToolEnd: (name, output) => {
            const tc = pendingToolCalls.find(
              (t) => t.name === name && t.running,
            );
            if (tc) {
              tc.running = false;
              tc.output = output;
            }
            setActiveToolCalls([...pendingToolCalls]);
          },
        });

        finalizeSegment();
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: `Error: ${err}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setStreamingText("");
        setActiveToolCalls([]);
      }
    }

    setIsLoading(false);
    processingRef.current = false;
  }, []);

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionRef.current) return;

      // Handle /quit
      if (trimmed === "/quit" || trimmed === "/exit") {
        if (sessionRef.current) {
          const threadId = sessionRef.current.threadId;
          await endChatSession(sessionRef.current);
          sessionRef.current = null;
          process.stderr.write(
            `\nThread: ${threadId}\nResume with: \x1b[32mbotholomew chat --thread-id ${threadId}\x1b[0m\n`,
          );
        }
        exit();
        return;
      }

      setInputValue("");
      setInputHistory((prev) => [...prev, trimmed]);
      queueRef.current.push(trimmed);
      processQueue();
    },
    [exit, processQueue],
  );

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!ready || !sessionRef.current) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Starting chat session...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <MessageList
        messages={messages}
        streamingText={streamingText}
        isLoading={isLoading}
        activeToolCalls={activeToolCalls}
      />
      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        disabled={false}
        history={inputHistory}
        header={
          <StatusBar
            projectDir={projectDir}
            conn={sessionRef.current.conn}
            isLoading={isLoading}
          />
        }
      />
    </Box>
  );
}
