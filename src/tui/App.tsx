import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatSession,
  endChatSession,
  sendMessage,
  startChatSession,
} from "../chat/session.ts";
import type { Interaction } from "../db/threads.ts";
import { getThread } from "../db/threads.ts";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { Divider } from "./components/Divider.tsx";
import { HelpPanel } from "./components/HelpPanel.tsx";
import { InputBar } from "./components/InputBar.tsx";
import { type ChatMessage, MessageList } from "./components/MessageList.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TabBar, type TabId } from "./components/TabBar.tsx";
import type { ToolCallData } from "./components/ToolCall.tsx";
import { ToolPanel } from "./components/ToolPanel.tsx";

interface AppProps {
  projectDir: string;
  threadId?: string;
  initialPrompt?: string;
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
        timestamp: ix.created_at,
      });
    } else if (ix.kind === "tool_result") {
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

export function App({
  projectDir,
  threadId: resumeThreadId,
  initialPrompt,
}: AppProps) {
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
  const [activeTab, setActiveTab] = useState<TabId>(1);
  const [daemonRunning, setDaemonRunning] = useState(false);
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

        if (session.messages.length > 0) {
          const threadData = await getThread(session.conn, session.threadId);
          if (threadData) {
            setMessages(
              restoreMessagesFromInteractions(threadData.interactions),
            );
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: msgId(),
            role: "system" as const,
            content:
              "Press Tab to switch between panels. Type /help for commands.",
            timestamp: new Date(),
          },
        ]);

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

  // Tab switching via useInput at the App level
  // On the Chat tab (1), only Tab key switches — number keys go to InputBar.
  // On other tabs, both Tab and number keys switch tabs, Escape returns to Chat.
  useInput((input, key) => {
    // Ctrl+C exits
    if (input === "c" && key.ctrl) {
      exit();
      return;
    }

    // Tab key cycles tabs — always active (InputBar ignores tab)
    if (key.tab && !key.shift) {
      setActiveTab((t) => ((t % 4) + 1) as TabId);
      return;
    }

    if (activeTab !== 1) {
      // Number keys jump to tab on non-chat tabs
      const num = Number.parseInt(input, 10);
      if (num >= 1 && num <= 4) {
        setActiveTab(num as TabId);
        return;
      }
      // Escape returns to chat
      if (key.escape) {
        setActiveTab(1);
        return;
      }
    }
  });

  const processQueue = useCallback(async () => {
    if (processingRef.current || !sessionRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const trimmed = queueRef.current.shift();
      if (!trimmed) break;
      setIsLoading(true);
      setStreamingText("");
      setActiveToolCalls([]);

      const userMsg: ChatMessage = {
        id: msgId(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

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
            const tc: ToolCallData = {
              name,
              input,
              running: true,
              timestamp: new Date(),
            };
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

  // Auto-submit initial prompt once session is ready
  const initialPromptSent = useRef(false);
  useEffect(() => {
    if (ready && initialPrompt && !initialPromptSent.current) {
      initialPromptSent.current = true;
      queueRef.current.push(initialPrompt);
      setInputHistory((prev) => [...prev, initialPrompt]);
      processQueue();
    }
  }, [ready, initialPrompt, processQueue]);

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionRef.current) return;

      setInputValue("");

      if (trimmed === "/help") {
        const helpMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: [
            "Navigation:",
            "  Tab            Cycle between panels",
            "  1-4            Jump to panel (when not in Chat)",
            "  Escape         Return to Chat",
            "",
            "Chat (Tab 1):",
            "  Enter          Send message",
            "  ⌥+Enter        Insert newline",
            "  ↑/↓            Browse input history",
            "",
            "Tools (Tab 2):",
            "  ↑/↓            Select tool call",
            "  Shift+↑/↓      Scroll detail pane",
            "  j/k            Scroll detail pane",
            "",
            "Context (Tab 3):",
            "  ↑/↓            Navigate items",
            "  Enter          Expand directory / preview file",
            "  Backspace      Go up one directory",
            "  /              Search context",
            "  d              Delete selected item",
            "",
            "Commands:",
            "  /help           Show this help",
            "  /quit, /exit    End the chat session",
          ].join("\n"),
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, helpMsg]);
        return;
      }

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

      setInputHistory((prev) => [...prev, trimmed]);
      queueRef.current.push(trimmed);
      processQueue();
    },
    [exit, processQueue],
  );

  const allToolCalls = useMemo(
    () => messages.flatMap((m) => m.toolCalls ?? []),
    [messages],
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

  const conn = sessionRef.current.conn;
  const threadId = sessionRef.current.threadId;

  return (
    <Box flexDirection="column" height="100%">
      <TabBar activeTab={activeTab} />
      <Divider isLoading={isLoading} />

      {/* Tab content area */}
      {activeTab === 1 && (
        <MessageList
          messages={messages}
          streamingText={streamingText}
          isLoading={isLoading}
          activeToolCalls={activeToolCalls}
        />
      )}
      {activeTab === 2 && (
        <ToolPanel toolCalls={allToolCalls} isActive={activeTab === 2} />
      )}
      {activeTab === 3 && (
        <ContextPanel conn={conn} isActive={activeTab === 3} />
      )}
      {activeTab === 4 && (
        <HelpPanel
          projectDir={projectDir}
          threadId={threadId}
          daemonRunning={daemonRunning}
        />
      )}

      {/* Bottom bar: StatusBar + InputBar (input only on Chat tab) */}
      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        disabled={activeTab !== 1}
        history={inputHistory}
        header={
          <StatusBar
            projectDir={projectDir}
            conn={conn}
            isLoading={isLoading}
            onDaemonStatusChange={setDaemonRunning}
          />
        }
      />
    </Box>
  );
}
