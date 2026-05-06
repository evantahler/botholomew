import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import {
  abortActiveStream,
  type ChatSession,
  clearChatSession,
} from "../chat/session.ts";
import type { ContextUsage } from "../chat/usage.ts";
import { handleSlashCommand } from "../skills/commands.ts";
import type { ChatMessage } from "./components/MessageList.tsx";
import type { QueueEntry } from "./hooks/useMessageQueue.ts";
import { msgId } from "./messages.ts";

interface UseChatSubmitParams {
  sessionRef: MutableRefObject<ChatSession | null>;
  queueRef: MutableRefObject<QueueEntry[]>;
  processingRef: MutableRefObject<boolean>;
  clearingRef: MutableRefObject<boolean>;
  syncQueue: () => void;
  processQueue: () => Promise<void>;
  performShutdown: () => Promise<void>;
  clearStreamingState: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  setInputHistory: Dispatch<SetStateAction<string[]>>;
  setMessagesEpoch: Dispatch<SetStateAction<number>>;
  setChatTitle: (t: string | undefined) => void;
  setClearing: Dispatch<SetStateAction<boolean>>;
  setUsage: Dispatch<SetStateAction<ContextUsage | null>>;
}

export function useChatSubmit({
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
}: UseChatSubmitParams): (text: string) => Promise<void> {
  return useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionRef.current) return;
      // /clear is mid-flight: don't queue against the old thread id.
      if (clearingRef.current) return;

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
          exit: () => void performShutdown(),
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
            // Block new submissions until the new thread id is in place —
            // otherwise the user's first post-/clear message races the
            // async createThread, runs against the old thread id, and is
            // then wiped by setMessages([sys]) below.
            clearingRef.current = true;
            setClearing(true);
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
                clearStreamingState();
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
              } finally {
                clearingRef.current = false;
                setClearing(false);
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
    [
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
    ],
  );
}
