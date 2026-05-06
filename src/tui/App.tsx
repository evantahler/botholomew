import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  abortActiveStream,
  type ChatSession,
  clearChatSession,
  endChatSession,
  sendMessage,
  startChatSession,
} from "../chat/session.ts";
import type { ContextUsage } from "../chat/usage.ts";
import {
  BUILTIN_SLASH_COMMANDS,
  handleSlashCommand,
  type SlashCommand,
} from "../skills/commands.ts";
import { getThread, type Interaction } from "../threads/store.ts";
import { MAX_INLINE_CHARS, PAGE_SIZE_CHARS } from "../worker/large-results.ts";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { HelpPanel } from "./components/HelpPanel.tsx";
import { InputBar } from "./components/InputBar.tsx";
import { AnimatedLogo } from "./components/Logo.tsx";
import {
  type ChatMessage,
  MessageBubble,
  MessageList,
} from "./components/MessageList.tsx";
import { QueuePanel } from "./components/QueuePanel.tsx";
import { SchedulePanel } from "./components/SchedulePanel.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TabBar, type TabId } from "./components/TabBar.tsx";
import { TaskPanel } from "./components/TaskPanel.tsx";
import { ThreadPanel } from "./components/ThreadPanel.tsx";
import type { ToolCallData } from "./components/ToolCall.tsx";
import { ToolPanel } from "./components/ToolPanel.tsx";
import { WorkerPanel } from "./components/WorkerPanel.tsx";
import { IdleProvider, useIdle } from "./idle.tsx";
import { buildSlashCommands, getSlashMatches } from "./slashCompletion.ts";
import { ansi } from "./theme.ts";

interface AppProps {
  projectDir: string;
  threadId?: string;
  initialPrompt?: string;
  idleTimeoutMs: number;
}

let nextMsgId = 0;
function msgId(): string {
  return `msg-${++nextMsgId}`;
}

// Tab routing: Ctrl+<letter> jumps to a tab. Chosen for memorability — first
// available letter that doesn't collide with other Ctrl bindings (Ctrl+C exit,
// Ctrl+J/K/X/E queue ops on Chat).
//
// Help is bound to Ctrl+G rather than Ctrl+H because most terminals deliver
// Ctrl+H as ASCII 0x08 (backspace). Bonus: macOS Terminal.app and several
// other terminals map Ctrl+/ to BEL (0x07), the same byte as Ctrl+G — so this
// binding also catches the Ctrl+/ keystroke on those terminals "for free".
// We also accept "/" and "_" as fallbacks for terminals that deliver Ctrl+/
// as 0x1F or as the literal "/" with ctrl=true (Kitty keyboard protocol).
const TAB_BY_CTRL_KEY: Record<string, TabId> = {
  a: 1, // ch[a]t
  o: 2, // t[o]ols
  n: 3, // co[n]text
  t: 4, // [t]asks
  r: 5, // th[r]eads
  s: 6, // [s]chedules
  w: 7, // [w]orkers
  g: 8, // help (also catches Ctrl+/ on terminals that map it to BEL)
  "/": 8, // help (Kitty keyboard protocol)
  _: 8, // help (terminals that send Ctrl+/ as 0x1F)
};

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
  idleTimeoutMs,
}: AppProps) {
  return (
    <IdleProvider timeoutMs={idleTimeoutMs}>
      <AppInner
        projectDir={projectDir}
        threadId={resumeThreadId}
        initialPrompt={initialPrompt}
      />
    </IdleProvider>
  );
}

interface AppInnerProps {
  projectDir: string;
  threadId?: string;
  initialPrompt?: string;
}

function AppInner({
  projectDir,
  threadId: resumeThreadId,
  initialPrompt,
}: AppInnerProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { markActivity } = useIdle();
  // Pin the root box to a known viewport height so the rendered frame size
  // never crosses the viewport boundary. Ink 7's renderer wipes scrollback
  // (`shouldClearTerminalForFrame` → `ansiEscapes.clearTerminal`) whenever
  // the dynamic frame transitions in/out of fullscreen, so a fluctuating
  // `outputHeight` (streaming text + tool boxes appearing/disappearing) used
  // to delete the chat history on every turn. Ink doesn't pin a height on
  // its internal root, so a `height="100%"` on our root collapses to `auto`
  // — we have to pass the explicit row count and re-read it on resize.
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setRows(stdout.rows ?? 24);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesEpoch, setMessagesEpoch] = useState(0);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallData[]>([]);
  const [preparingTool, setPreparingTool] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const skipSplash = !!(resumeThreadId || initialPrompt);
  const [splashDone, setSplashDone] = useState(skipSplash);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(1);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [chatTitle, setChatTitle] = useState<string | undefined>(undefined);
  const queueRef = useRef<Array<{ display: string; content: string }>>([]);
  const processingRef = useRef(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [selectedQueueIndex, setSelectedQueueIndex] = useState(0);

  const syncQueue = useCallback(() => {
    const snapshot = queueRef.current.map((e) => e.display);
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
          const threadData = await getThread(
            session.projectDir,
            session.threadId,
          );
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
              "Switch panels with Ctrl+<letter> (^a chat · ^o tools · ^n context · ^t tasks · ^r threads · ^s schedules · ^w workers) — `?` for help. Type /help for commands.",
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

  // Capture-mode tab auto-cycle. Under VHS/ttyd the Tab key doesn't reliably
  // reach Ink, so a docs tape can't drive the tab tour by keystroke. When
  // BOTHOLOMEW_CAPTURE_TAB_CYCLE is set, schedule timers that walk through
  // every tab so a single recording can show all panels.
  //
  // Format: "dwellMs" or "dwellMs:startDelayMs". The optional start delay
  // lets a tape finish a streamed chat reply before the cycle kicks in.
  useEffect(() => {
    const spec = process.env.BOTHOLOMEW_CAPTURE_TAB_CYCLE;
    if (!spec) return;
    const [dwellRaw, delayRaw] = spec.split(":");
    const dwellMs = Number.parseInt(dwellRaw ?? "", 10) || 2500;
    const startDelayMs = Number.parseInt(delayRaw ?? "", 10) || 0;
    const sequence: TabId[] = [2, 3, 4, 5, 6, 7, 8, 1];
    const timers = sequence.map((tab, i) =>
      setTimeout(() => setActiveTab(tab), startDelayMs + dwellMs * (i + 1)),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  // Stable ref for App-level input handler — same pattern as InputBar to
  // prevent Ink's useInput from re-registering stdin listeners on every render.
  const activeTabRef = useRef(activeTab);
  const queuedMessagesRef = useRef(queuedMessages);
  const selectedQueueIndexRef = useRef(selectedQueueIndex);
  activeTabRef.current = activeTab;
  queuedMessagesRef.current = queuedMessages;
  selectedQueueIndexRef.current = selectedQueueIndex;

  const slashCommandsRef = useRef<SlashCommand[]>([]);
  const inputValueRef = useRef("");

  const markActivityRef = useRef(markActivity);
  markActivityRef.current = markActivity;

  const stableAppHandler = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: Ink's Key type is not exported
    (input: string, key: any) => {
      markActivityRef.current();

      // Ctrl+C exits
      if (input === "c" && key.ctrl) {
        exit();
        return;
      }

      // Ctrl+<letter> jumps directly to a tab from any tab. On Chat, only
      // suppress these if the slash-autocomplete popup needs the keystroke
      // (Ctrl combos don't drive the popup, but keep the guard symmetric
      // with the previous Tab-cycle behavior).
      if (key.ctrl) {
        const tabForKey = TAB_BY_CTRL_KEY[input];
        if (tabForKey !== undefined) {
          if (activeTabRef.current === 1) {
            const popupOpen = getSlashMatches(
              inputValueRef.current,
              slashCommandsRef.current,
            );
            if (popupOpen) return;
          }
          setActiveTab(tabForKey);
          return;
        }
      }

      const tab = activeTabRef.current;

      // Esc on Chat tab while a turn is in flight: steer / interrupt.
      // Calls MessageStream.abort() at the SDK layer; tools already running
      // finish normally, but no further LLM turn is started.
      if (key.escape && tab === 1 && processingRef.current) {
        const session = sessionRef.current;
        if (session) {
          abortActiveStream(session);
          return;
        }
      }

      // Queue manipulation keybindings (only when queue has items on Chat tab)
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
            setInputValue(msg.display);
          }
          return;
        }
      }

      if (tab !== 1) {
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
      const entry = queueRef.current.shift();
      syncQueue();
      if (!entry) break;
      setIsLoading(true);
      setStreamingText("");
      setActiveToolCalls([]);
      setPreparingTool(null);

      const userMsg: ChatMessage = {
        id: msgId(),
        role: "user",
        content: entry.display,
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
        await sendMessage(sessionRef.current, entry.content, {
          onToken: (token) => {
            currentText += token;
            const now = Date.now();
            if (now - lastStreamFlush >= 50) {
              setStreamingText(currentText);
              lastStreamFlush = now;
              markActivityRef.current();
            }
          },
          onToolPreparing: (id, name) => {
            markActivityRef.current();
            setPreparingTool({ id, name });
          },
          onToolStart: (id, name, input) => {
            markActivityRef.current();
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
            setPreparingTool(null);
          },
          onToolEnd: (id, _name, output, isError, meta) => {
            markActivityRef.current();
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
          onToolNotify: (id, message) => {
            markActivityRef.current();
            const tc = pendingToolCalls.find((t) => t.id === id);
            if (tc) {
              tc.notes = [...(tc.notes ?? []), message];
              setActiveToolCalls([...pendingToolCalls]);
            }
          },
          onUsage: (info) => {
            setUsage(info);
          },
          takeInjections: () => {
            // Drain queued messages into the running turn so the agent sees
            // them on the next LLM call instead of after the whole tool loop.
            // Finalize the in-flight assistant segment first so the new user
            // bubbles render in the right order in the chat view.
            if (queueRef.current.length === 0) return [];
            if (currentText || pendingToolCalls.length > 0) {
              finalizeSegment();
            }
            const drained = queueRef.current.splice(0);
            syncQueue();
            for (const e of drained) {
              const userMsg: ChatMessage = {
                id: msgId(),
                role: "user",
                content: e.display,
                timestamp: new Date(),
              };
              setMessages((prev) => [...prev, userMsg]);
            }
            return drained.map((e) => e.content);
          },
        });

        if (sessionRef.current?.aborted) {
          currentText += currentText
            ? "\n\n_(steered — response interrupted)_"
            : "_(steered — no response)_";
        }
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
        setPreparingTool(null);
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
      queueRef.current.push({
        display: initialPrompt,
        content: initialPrompt,
      });
      syncQueue();
      setInputHistory((prev) => [...prev, initialPrompt]);
      processQueue();
    }
  }, [ready, initialPrompt, processQueue, syncQueue]);

  // Poll for chat thread title updates
  useEffect(() => {
    if (!ready || !sessionRef.current) return;
    let mounted = true;

    const refreshTitle = async () => {
      const session = sessionRef.current;
      if (!session) return;
      const result = await getThread(session.projectDir, session.threadId);
      if (mounted && result?.thread.title) {
        setChatTitle(result.thread.title);
      }
    };

    refreshTitle();
    const interval = setInterval(refreshTitle, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [ready]);

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionRef.current) return;

      setInputValue("");

      if (trimmed === "/help") {
        const skills = sessionRef.current.skills;
        const lines: string[] = [
          "For the full keyboard reference, switch to the Help tab (`Ctrl+g`) — this message lists chat commands only.",
          "",
          "Slash commands:",
          "  /help           Show this message",
          "  /skills         List available skills",
          "  /clear          End current thread and start a new one",
          "  /exit           End the chat session",
        ];
        if (skills.size > 0) {
          lines.push("", "Skills:");
          for (const [skillName, skill] of skills) {
            lines.push(
              `  /${skillName.padEnd(14)} ${skill.description || "(no description)"}`,
            );
          }
        } else {
          lines.push("", "Skills:", "  (none — add .md files to skills/)");
        }

        const helpMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: lines.join("\n"),
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, helpMsg]);
        return;
      }

      if (trimmed.startsWith("/")) {
        const skills = sessionRef.current.skills;
        const handled = handleSlashCommand(trimmed, {
          skills,
          addSystemMessage: (content) => {
            const msg: ChatMessage = {
              id: msgId(),
              role: "system",
              content,
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, msg]);
          },
          queueUserMessage: (content, opts) => {
            setInputHistory((prev) => [...prev, trimmed]);
            queueRef.current.push({
              display: opts?.display ?? content,
              content,
            });
            syncQueue();
            processQueue();
          },
          exit,
          clearChat: () => {
            const session = sessionRef.current;
            if (!session) return;
            // Drain any queued messages so they don't leak into the new thread.
            queueRef.current.length = 0;
            syncQueue();
            // Abort any in-flight stream synchronously so its callbacks stop
            // firing before we reset UI state. clearChatSession also calls
            // this, but doing it here lets us start the wait-for-quiesce
            // poll below immediately rather than waiting on the
            // createThread/endThread round trip first.
            abortActiveStream(session);
            void (async () => {
              // Wait for any in-flight processQueue iteration to finish so
              // its trailing `finalizeSegment` can't race our state reset
              // and re-add the previous thread's assistant message after
              // the UI has been cleared. (Issue #190.)
              while (processingRef.current) {
                await new Promise((r) => setTimeout(r, 10));
              }
              try {
                const { previousThreadId, newThreadId } =
                  await clearChatSession(session);
                // Ink's <Static> writes messages to terminal scrollback and
                // can't un-write them, so setMessages alone leaves the old
                // lines visible. Clear the terminal (including scrollback)
                // and bump the epoch key on <Static> to force a fresh mount.
                process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
                setMessages([
                  {
                    id: msgId(),
                    role: "system",
                    content: `Started a new chat thread (${newThreadId}). Previous thread saved — resume with: botholomew chat --thread-id ${previousThreadId}`,
                    timestamp: new Date(),
                  },
                ]);
                setMessagesEpoch((n) => n + 1);
                setChatTitle(undefined);
                setStreamingText("");
                setActiveToolCalls([]);
                setPreparingTool(null);
                setUsage(null);
              } catch (err) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: msgId(),
                    role: "system",
                    content: `Failed to clear chat: ${err}`,
                    timestamp: new Date(),
                  },
                ]);
              }
            })();
          },
        });
        if (handled) return;
      }

      setInputHistory((prev) => [...prev, trimmed]);
      queueRef.current.push({ display: trimmed, content: trimmed });
      syncQueue();
      processQueue();
    },
    [exit, processQueue, syncQueue],
  );

  const sessionDbPath = sessionRef.current?.dbPath;
  const inputBarHeader = useMemo(
    () =>
      sessionDbPath ? (
        <StatusBar
          projectDir={projectDir}
          dbPath={sessionDbPath}
          chatTitle={chatTitle}
          onWorkerStatusChange={setWorkerRunning}
        />
      ) : null,
    [projectDir, sessionDbPath, chatTitle],
  );

  const sessionSkills = ready ? sessionRef.current?.skills : undefined;
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const skillList = sessionSkills
      ? Array.from(sessionSkills.values()).map((s) => ({
          name: s.name,
          description: s.description,
          takesArgs:
            s.arguments.length > 0 ||
            /\$ARGUMENTS\b/.test(s.body) ||
            /\$[1-9]\b/.test(s.body),
        }))
      : [];
    return buildSlashCommands(BUILTIN_SLASH_COMMANDS, skillList);
  }, [sessionSkills]);

  slashCommandsRef.current = slashCommands;
  inputValueRef.current = inputValue;

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

  const _dbPath = sessionRef.current.dbPath;
  const threadId = sessionRef.current.threadId;

  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      {/* Completed messages — rendered once to terminal scrollback.
          Must live outside the display="none" tab wrappers so the <Static>
          node always has proper terminal width in its Yoga layout.
          Otherwise Ink's border renderer crashes with a negative
          contentWidth when tool-call boxes are rendered at width 0. */}
      <Static key={messagesEpoch} items={messages}>
        {(msg) => <MessageBubble key={msg.id} message={msg} />}
      </Static>

      {/* Tab content area — all panels stay mounted to avoid expensive
          remount cycles. display="none" hides inactive panels from
          layout without destroying them.
          The chat tab's flexGrow box is overflow-clipped so streaming
          content can't push the rendered frame past the viewport — see
          the comment on the `rows` state for why that matters.
          `justifyContent="flex-end"` keeps active streaming content + the
          tool-call card pinned to the bottom of the chat area (just
          above the input bar) instead of leaving a tall gap below them. */}
      <Box
        display={activeTab === 1 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        justifyContent="flex-end"
      >
        <MessageList
          streamingText={streamingText}
          isLoading={isLoading}
          activeToolCalls={activeToolCalls}
          preparingTool={preparingTool}
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
        <ContextPanel projectDir={projectDir} isActive={activeTab === 3} />
      </Box>
      <Box
        display={activeTab === 4 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <TaskPanel projectDir={projectDir} isActive={activeTab === 4} />
      </Box>
      <Box
        display={activeTab === 5 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <ThreadPanel
          projectDir={projectDir}
          activeThreadId={threadId}
          isActive={activeTab === 5}
        />
      </Box>
      <Box
        display={activeTab === 6 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <SchedulePanel projectDir={projectDir} isActive={activeTab === 6} />
      </Box>
      <Box
        display={activeTab === 7 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <WorkerPanel projectDir={projectDir} isActive={activeTab === 7} />
      </Box>
      <Box
        display={activeTab === 8 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
      >
        <HelpPanel
          projectDir={projectDir}
          threadId={threadId}
          workerRunning={workerRunning}
          usage={usage}
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
        slashCommands={slashCommands}
      />
      <TabBar activeTab={activeTab} usage={usage} />
    </Box>
  );
}
