import { useApp } from "ink";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  abortActiveStream,
  type ChatSession,
  endChatSession,
  startChatSession,
} from "../../chat/session.ts";
import { getThread } from "../../threads/store.ts";
import type { ChatMessage } from "../components/MessageList.tsx";
import { msgId } from "../messages.ts";
import { restoreMessagesFromInteractions } from "../restoreMessages.ts";
import { ansi } from "../theme.ts";

interface UseChatSessionParams {
  projectDir: string;
  resumeThreadId: string | undefined;
  initialPrompt: string | undefined;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

interface UseChatSessionResult {
  sessionRef: MutableRefObject<ChatSession | null>;
  ready: boolean;
  splashDone: boolean;
  performShutdown: () => Promise<void>;
}

export function useChatSession({
  projectDir,
  resumeThreadId,
  initialPrompt,
  setMessages,
  setError,
}: UseChatSessionParams): UseChatSessionResult {
  const { exit } = useApp();
  const [ready, setReady] = useState(false);
  const skipSplash = !!(resumeThreadId || initialPrompt);
  const [splashDone, setSplashDone] = useState(skipSplash);
  const sessionRef = useRef<ChatSession | null>(null);
  const shuttingDownRef = useRef(false);

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

        if (resumeThreadId) {
          // Always hydrate on resume so the Tools tab and chat history
          // pick up prior tool_use/tool_result rows from the CSV — even if
          // the thread has no plain message-kind interactions yet.
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
      // Fire-and-forget safety net: only triggers when unmount happens via a
      // path that didn't go through performShutdown (which nulls sessionRef
      // first). React doesn't await unmount cleanups, so the goodbye lands
      // before mcpx finishes closing — that's fine for non-Ctrl-C paths.
      if (sessionRef.current) {
        const session = sessionRef.current;
        const threadId = session.threadId;
        abortActiveStream(session);
        void endChatSession(session);
        process.stderr.write(
          `\nThread: ${threadId}\nResume with: ${ansi.success}botholomew chat --thread-id ${threadId}${ansi.reset}\nBye!\n`,
        );
      }
    };
  }, [projectDir, resumeThreadId, setMessages, setError]);

  const performShutdown = useCallback(async () => {
    if (shuttingDownRef.current) {
      // Second Ctrl-C while cleanup is in flight — give the user an escape
      // hatch. 130 = standard SIGINT exit code.
      process.exit(130);
    }
    shuttingDownRef.current = true;

    const session = sessionRef.current;
    // Null the ref so the useEffect cleanup that runs on Ink unmount becomes
    // a no-op — otherwise it would double-print the goodbye and double-close
    // the mcpx client.
    sessionRef.current = null;

    if (session) {
      const threadId = session.threadId;
      abortActiveStream(session);
      try {
        await endChatSession(session);
      } catch {
        // Best-effort: the user pressed Ctrl-C, surfacing a stack trace here
        // would just hide the goodbye line.
      }
      process.stderr.write(
        `\nThread: ${threadId}\nResume with: ${ansi.success}botholomew chat --thread-id ${threadId}${ansi.reset}\nBye!\n`,
      );
    }
    exit();
  }, [exit]);

  // Minimum splash screen duration
  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  return { sessionRef, ready, splashDone, performShutdown };
}
