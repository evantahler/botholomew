import { useInput } from "ink";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
} from "react";
import { abortActiveStream, type ChatSession } from "../../chat/session.ts";
import type { SlashCommand } from "../../skills/commands.ts";
import type { TabId } from "../components/TabBar.tsx";
import { TAB_BY_CTRL_KEY } from "../keys.ts";
import { getSlashMatches } from "../slashCompletion.ts";
import type { QueueEntry } from "./useMessageQueue.ts";

interface UseAppKeybindingsParams {
  activeTab: TabId;
  setActiveTab: Dispatch<SetStateAction<TabId>>;
  performShutdown: () => Promise<void>;
  sessionRef: MutableRefObject<ChatSession | null>;
  processingRef: MutableRefObject<boolean>;
  queueRef: MutableRefObject<QueueEntry[]>;
  queuedMessages: string[];
  selectedQueueIndex: number;
  setSelectedQueueIndex: Dispatch<SetStateAction<number>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  syncQueue: () => void;
  slashCommandsRef: MutableRefObject<SlashCommand[]>;
  inputValueRef: MutableRefObject<string>;
  markActivityRef: MutableRefObject<() => void>;
}

export function useAppKeybindings({
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
}: UseAppKeybindingsParams): void {
  // Stable refs for the input handler — same pattern as InputBar to prevent
  // Ink's useInput from re-registering stdin listeners on every render.
  const activeTabRef = useRef(activeTab);
  const queuedMessagesRef = useRef(queuedMessages);
  const selectedQueueIndexRef = useRef(selectedQueueIndex);
  activeTabRef.current = activeTab;
  queuedMessagesRef.current = queuedMessages;
  selectedQueueIndexRef.current = selectedQueueIndex;

  const handler = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: Ink's Key type is not exported
    (input: string, key: any) => {
      markActivityRef.current();

      // Ctrl+C exits. Routed through performShutdown so the in-flight LLM
      // stream is aborted and mcpx is closed before we unmount Ink — without
      // that, one Ctrl-C prints the goodbye but the process stays pinned by
      // the open HTTPS socket and a second Ctrl-C is needed.
      if (input === "c" && key.ctrl) {
        void performShutdown();
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
            // Ctrl+E edits a queued message when one is selected; only
            // fall through to the Threads tab-jump when the queue is empty.
            if (input === "e" && queuedMessagesRef.current.length > 0) {
              // handled by the queue keybindings block below
            } else {
              setActiveTab(tabForKey);
              return;
            }
          } else {
            setActiveTab(tabForKey);
            return;
          }
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
    [
      performShutdown,
      sessionRef,
      processingRef,
      queueRef,
      setActiveTab,
      setSelectedQueueIndex,
      setInputValue,
      syncQueue,
      slashCommandsRef,
      inputValueRef,
      markActivityRef,
    ],
  );

  useInput(handler);
}
