import { Box, Static, Text } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUILTIN_SLASH_COMMANDS,
  type SlashCommand,
} from "../skills/commands.ts";
import { InputBar } from "./components/InputBar.tsx";
import { AnimatedLogo } from "./components/Logo.tsx";
import {
  type ChatMessage,
  MessageBubble,
  MessageList,
} from "./components/MessageList.tsx";
import { QueuePanel } from "./components/QueuePanel.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TabBar, type TabId } from "./components/TabBar.tsx";
import { TabPanels } from "./components/TabPanels.tsx";
import { useChatSubmit } from "./handleSubmit.ts";
import { useAppKeybindings } from "./hooks/useAppKeybindings.ts";
import { useCaptureTabCycle } from "./hooks/useCaptureTabCycle.ts";
import { useChatSession } from "./hooks/useChatSession.ts";
import { useChatTitlePolling } from "./hooks/useChatTitlePolling.ts";
import { useMessageQueue } from "./hooks/useMessageQueue.ts";
import { useTerminalRows } from "./hooks/useTerminalRows.ts";
import { IdleProvider, useIdle } from "./idle.tsx";
import { FOOTER_RESERVE } from "./messages.ts";
import { buildSlashCommands } from "./slashCompletion.ts";

interface AppProps {
  projectDir: string;
  threadId?: string;
  initialPrompt?: string;
  idleTimeoutMs: number;
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
  const { markActivity } = useIdle();
  const rows = useTerminalRows();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesEpoch, setMessagesEpoch] = useState(0);
  // `clearing` gates new submissions while /clear's async work is in flight.
  // Without it, a message submitted during the clearChatSession await runs
  // sendMessage against the OLD thread id, then the IIFE's setMessages([sys])
  // overwrites the user bubble it added — the message disappears.
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  const [inputValue, setInputValue] = useState("");
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(1);
  const [workerRunning, setWorkerRunning] = useState(false);

  const markActivityRef = useRef(markActivity);
  markActivityRef.current = markActivity;

  const { sessionRef, ready, splashDone, performShutdown } = useChatSession({
    projectDir,
    resumeThreadId,
    initialPrompt,
    setMessages,
    setError,
  });

  const queue = useMessageQueue({
    sessionRef,
    setMessages,
    markActivityRef,
  });
  const {
    queueRef,
    processingRef,
    queuedMessages,
    selectedQueueIndex,
    setSelectedQueueIndex,
    syncQueue,
    processQueue,
    isLoading,
    streamingText,
    activeToolCalls,
    preparingTool,
    streamStartedAt,
    usage,
    setUsage,
    clearStreamingState,
  } = queue;

  const { chatTitle, setChatTitle } = useChatTitlePolling(ready, sessionRef);

  useCaptureTabCycle(setActiveTab);

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
  }, [ready, initialPrompt, processQueue, syncQueue, queueRef]);

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

  const slashCommandsRef = useRef<SlashCommand[]>([]);
  const inputValueRef = useRef("");
  slashCommandsRef.current = slashCommands;
  inputValueRef.current = inputValue;

  useAppKeybindings({
    activeTab,
    setActiveTab,
    performShutdown,
    sessionRef,
    processingRef,
    queueRef,
    queuedMessages,
    selectedQueueIndex,
    setSelectedQueueIndex,
    setInputValue,
    syncQueue,
    slashCommandsRef,
    inputValueRef,
    markActivityRef,
  });

  const handleSubmit = useChatSubmit({
    sessionRef,
    queueRef,
    processingRef,
    clearingRef,
    syncQueue,
    processQueue,
    performShutdown,
    clearStreamingState,
    setMessages,
    setInputValue,
    setInputHistory,
    setMessagesEpoch,
    setChatTitle,
    setClearing,
    setUsage,
  });

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

  const threadId = sessionRef.current.threadId;
  const panelHeight = Math.max(1, rows - FOOTER_RESERVE);
  const onChatTab = activeTab === 1;

  return (
    // The root box is auto-sized on the chat tab so the dynamic frame stays
    // small and the static-rendered chat history (in scrollback above the
    // frame) flows directly into the streaming reply with no blank pad.
    //
    // On every other tab we pin the root to `height={rows}` so the dynamic
    // frame fills the entire viewport — without that, the panel + footer
    // are shorter than the terminal and the bottom of the chat scrollback
    // bleeds through above the active panel. Switching chat→panel goes
    // small→rows (no wipe, since `nextOutputHeight === viewportRows` is
    // not "overflowing"). Switching panel→chat goes rows→small, which
    // does trip Ink's `isLeavingFullscreen` clear, but Ink immediately
    // re-emits `fullStaticOutput` so chat history is preserved.
    <Box flexDirection="column" {...(onChatTab ? {} : { height: rows })}>
      {/* Completed messages — rendered once to terminal scrollback.
          Must live outside the display="none" tab wrappers so the <Static>
          node always has proper terminal width in its Yoga layout.
          Otherwise Ink's border renderer crashes with a negative
          contentWidth when tool-call boxes are rendered at width 0. */}
      <Static key={messagesEpoch} items={messages}>
        {(msg) => <MessageBubble key={msg.id} message={msg} />}
      </Static>

      {/* Chat tab body: `maxHeight={panelHeight}` (not `height`) so the box
          shrinks to its content when streaming is short or absent. When
          streaming overflows, the box stops at `panelHeight`;
          `justifyContent="flex-end"` + `overflow="hidden"` clip the *top*
          so the most-recent tokens stay visible above the input bar.
          The frame stays strictly below `rows`, so Ink never wipes
          scrollback during a turn. */}
      <Box
        display={onChatTab ? "flex" : "none"}
        flexDirection="column"
        maxHeight={panelHeight}
        overflow="hidden"
        justifyContent="flex-end"
      >
        <MessageList
          streamingText={streamingText}
          isLoading={isLoading}
          activeToolCalls={activeToolCalls}
          preparingTool={preparingTool}
          streamStartedAt={streamStartedAt}
        />
      </Box>

      <TabPanels
        activeTab={activeTab}
        projectDir={projectDir}
        threadId={threadId}
        allToolCalls={allToolCalls}
        workerRunning={workerRunning}
        usage={usage}
      />

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
        disabled={activeTab !== 1 || clearing}
        history={inputHistory}
        header={inputBarHeader}
        slashCommands={slashCommands}
      />
      <TabBar activeTab={activeTab} usage={usage} />
    </Box>
  );
}
