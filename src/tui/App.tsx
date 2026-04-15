import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatSession,
  endChatSession,
  sendMessage,
  startChatSession,
} from "../chat/session.ts";
import { MAX_INLINE_CHARS, PAGE_SIZE_CHARS } from "../daemon/large-results.ts";
import type { Interaction } from "../db/threads.ts";
import { getThread } from "../db/threads.ts";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { HelpPanel } from "./components/HelpPanel.tsx";
import { InputBar } from "./components/InputBar.tsx";
import { AnimatedLogo } from "./components/Logo.tsx";
import { type ChatMessage, MessageList } from "./components/MessageList.tsx";
import { QueuePanel } from "./components/QueuePanel.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TabBar, type TabId } from "./components/TabBar.tsx";
import { TaskPanel } from "./components/TaskPanel.tsx";
import { ThreadPanel } from "./components/ThreadPanel.tsx";
import type { ToolCallData } from "./components/ToolCall.tsx";
import { ToolPanel } from "./components/ToolPanel.tsx";
import { ansi } from "./theme.ts";

interface AppProps {
  projectDir: string;
  threadId?: string;
  initialPrompt?: string;
}

let nextMsgId = 0;
function msgId(): string {
  return `msg-${++nextMsgId}`;
}

function detectToolError(output: string | undefined): boolean {
  if (!output) return false;
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === "object" && parsed?.is_error === true) return true;
  } catch {
    /* not JSON */
  }
  return false;
}

function restoreMessagesFromInteractions(
  interactions: Interaction[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  let pendingTools: ToolCallData[] = [];

  let restoredIdx = 0;
  for (const ix of interactions) {
    if (ix.kind === "tool_use") {
      pendingTools.push({
        id: `restored-${restoredIdx++}`,
        name: ix.tool_name ?? "unknown",
        input: ix.tool_input ?? "{}",
        running: false,
        timestamp: ix.created_at,
      });
    } else if (ix.kind === "tool_result") {
      const tc = pendingTools.find((t) => t.name === ix.tool_name && !t.output);
      if (tc) {
        tc.output = ix.content;
        tc.isError = detectToolError(ix.content);
        if (ix.content.length > MAX_INLINE_CHARS) {
          tc.largeResult = {
            id: "(restored)",
            chars: ix.content.length,
            pages: Math.ceil(ix.content.length / PAGE_SIZE_CHARS),
          };
        }
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
  const skipSplash = !!(resumeThreadId || initialPrompt);
  const [splashDone, setSplashDone] = useState(skipSplash);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(1);
  const [daemonRunning, setDaemonRunning] = useState(false);
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [selectedQueueIndex, setSelectedQueueIndex] = useState(0);

  const syncQueue = useCallback(() => {
    const snapshot = [...queueRef.current];
    setQueuedMessages(snapshot);
    setSelectedQueueIndex((prev) =>
      snapshot.length === 0 ? 0 : Math.min(prev, snapshot.length - 1),
    );
  }, []);

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
          `\nThread: ${threadId}\nResume with: ${ansi.success}botholomew chat --thread-id ${threadId}${ansi.reset}\n`,
        );
      }
    };
  }, [projectDir, resumeThreadId]);

  // Minimum splash screen duration
  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Stable ref for App-level input handler — same pattern as InputBar to
  // prevent Ink's useInput from re-registering stdin listeners on every render.
  const activeTabRef = useRef(activeTab);
  const queuedMessagesRef = useRef(queuedMessages);
  const selectedQueueIndexRef = useRef(selectedQueueIndex);
  activeTabRef.current = activeTab;
  queuedMessagesRef.current = queuedMessages;
  selectedQueueIndexRef.current = selectedQueueIndex;

  const stableAppHandler = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: Ink's Key type is not exported
    (input: string, key: any) => {
      // Ctrl+C exits
      if (input === "c" && key.ctrl) {
        exit();
        return;
      }

      // Tab key cycles tabs — always active (InputBar ignores tab)
      if (key.tab && !key.shift) {
        setActiveTab((t) => ((t % 6) + 1) as TabId);
        return;
      }

      // Queue manipulation keybindings (only when queue has items on Chat tab)
      const tab = activeTabRef.current;
      const queue = queuedMessagesRef.current;
      if (tab === 1 && queue.length > 0 && key.ctrl) {
        if (input === "j") {
          setSelectedQueueIndex((i) => Math.min(i + 1, queue.length - 1));
          return;
        }
        if (input === "k") {
          setSelectedQueueIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (input === "x") {
          queueRef.current.splice(selectedQueueIndexRef.current, 1);
          syncQueue();
          return;
        }
        if (input === "e") {
          const [msg] = queueRef.current.splice(
            selectedQueueIndexRef.current,
            1,
          );
          syncQueue();
          if (msg) {
            setInputValue(msg);
          }
          return;
        }
      }

      if (tab !== 1) {
        // Number keys jump to tab on non-chat tabs
        const num = Number.parseInt(input, 10);
        if (num >= 1 && num <= 6) {
          setActiveTab(num as TabId);
          return;
        }
        // Escape returns to chat
        if (key.escape) {
          setActiveTab(1);
          return;
        }
      }
    },
    [exit, syncQueue],
  );

  useInput(stableAppHandler);

  const processQueue = useCallback(async () => {
    if (processingRef.current || !sessionRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const trimmed = queueRef.current.shift();
      syncQueue();
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

      let lastStreamFlush = 0;
      try {
        await sendMessage(sessionRef.current, trimmed, {
          onToken: (token) => {
            currentText += token;
            const now = Date.now();
            if (now - lastStreamFlush >= 50) {
              setStreamingText(currentText);
              lastStreamFlush = now;
            }
          },
          onToolStart: (id, name, input) => {
            if (currentText) {
              finalizeSegment();
            }
            const tc: ToolCallData = {
              id,
              name,
              input,
              running: true,
              timestamp: new Date(),
            };
            pendingToolCalls.push(tc);
            setActiveToolCalls([...pendingToolCalls]);
          },
          onToolEnd: (id, _name, output, isError, meta) => {
            const tc = pendingToolCalls.find((t) => t.id === id);
            if (tc) {
              tc.running = false;
              tc.output = output;
              tc.isError = isError;
              if (meta?.largeResult) {
                tc.largeResult = meta.largeResult;
              }
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
  }, [syncQueue]);

  // Auto-submit initial prompt once session is ready
  const initialPromptSent = useRef(false);
  useEffect(() => {
    if (ready && initialPrompt && !initialPromptSent.current) {
      initialPromptSent.current = true;
      queueRef.current.push(initialPrompt);
      syncQueue();
      setInputHistory((prev) => [...prev, initialPrompt]);
      processQueue();
    }
  }, [ready, initialPrompt, processQueue, syncQueue]);

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
            "  1-6            Jump to panel (when not in Chat)",
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
            "Tasks (Tab 4):",
            "  ↑/↓            Navigate task list",
            "  Shift+↑/↓      Scroll detail pane",
            "  j/k            Scroll detail pane",
            "  f              Cycle status filter",
            "  p              Cycle priority filter",
            "  r              Refresh tasks",
            "",
            "Threads (Tab 5):",
            "  ↑/↓            Navigate thread list",
            "  Shift+↑/↓      Scroll detail pane",
            "  j/k            Scroll detail pane",
            "  f              Cycle type filter",
            "  d              Delete thread (with confirmation)",
            "  r              Refresh threads",
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
        exit();
        return;
      }

      setInputHistory((prev) => [...prev, trimmed]);
      queueRef.current.push(trimmed);
      syncQueue();
      processQueue();
    },
    [exit, processQueue, syncQueue],
  );

  const sessionConn = sessionRef.current?.conn;
  const inputBarHeader = useMemo(
    () =>
      sessionConn ? (
        <StatusBar
          projectDir={projectDir}
          conn={sessionConn}
          onDaemonStatusChange={setDaemonRunning}
        />
      ) : null,
    [projectDir, sessionConn],
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

  if (!ready || !splashDone || !sessionRef.current) {
    return (
      <Box
        flexDirection="column"
        padding={1}
        alignItems="center"
        justifyContent="center"
        height="100%"
      >
        <AnimatedLogo />
      </Box>
    );
  }

  const conn = sessionRef.current.conn;
  const threadId = sessionRef.current.threadId;

  return (
    <Box flexDirection="column" height="100%">
      {/* Tab content area — all panels stay mounted to avoid expensive
          remount cycles (especially <Static> in MessageList re-rendering
          the entire history). display="none" hides inactive panels from
          layout without destroying them. */}
      <Box
        display={activeTab === 1 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <MessageList
          messages={messages}
          streamingText={streamingText}
          isLoading={isLoading}
          activeToolCalls={activeToolCalls}
        />
      </Box>
      <Box
        display={activeTab === 2 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <ToolPanel toolCalls={allToolCalls} isActive={activeTab === 2} />
      </Box>
      <Box
        display={activeTab === 3 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <ContextPanel conn={conn} isActive={activeTab === 3} />
      </Box>
      <Box
        display={activeTab === 4 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <TaskPanel conn={conn} isActive={activeTab === 4} />
      </Box>
      <Box
        display={activeTab === 5 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <ThreadPanel
          conn={conn}
          activeThreadId={threadId}
          isActive={activeTab === 5}
        />
      </Box>
      <Box
        display={activeTab === 6 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <HelpPanel
          projectDir={projectDir}
          threadId={threadId}
          daemonRunning={daemonRunning}
        />
      </Box>

      {/* Queued messages (only on Chat tab) */}
      {activeTab === 1 && queuedMessages.length > 0 && (
        <QueuePanel
          messages={queuedMessages}
          selectedIndex={selectedQueueIndex}
        />
      )}

      {/* Bottom bar: StatusBar + InputBar (input only on Chat tab) + TabBar */}
      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        disabled={activeTab !== 1}
        history={inputHistory}
        header={inputBarHeader}
      />
      <TabBar activeTab={activeTab} />
    </Box>
  );
}
