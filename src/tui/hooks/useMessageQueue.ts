import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { type ChatSession, sendMessage } from "../../chat/session.ts";
import type { ContextUsage } from "../../chat/usage.ts";
import type { ChatMessage } from "../components/MessageList.tsx";
import type { ToolCallData } from "../components/ToolCall.tsx";
import { msgId } from "../messages.ts";

export interface QueueEntry {
  display: string;
  content: string;
}

interface UseMessageQueueParams {
  sessionRef: MutableRefObject<ChatSession | null>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  markActivityRef: MutableRefObject<() => void>;
}

export interface UseMessageQueueResult {
  queueRef: MutableRefObject<QueueEntry[]>;
  processingRef: MutableRefObject<boolean>;
  queuedMessages: string[];
  selectedQueueIndex: number;
  setSelectedQueueIndex: Dispatch<SetStateAction<number>>;
  syncQueue: () => void;
  processQueue: () => Promise<void>;
  isLoading: boolean;
  streamingText: string;
  activeToolCalls: ToolCallData[];
  preparingTool: { id: string; name: string } | null;
  streamStartedAt: Date | null;
  usage: ContextUsage | null;
  setUsage: Dispatch<SetStateAction<ContextUsage | null>>;
  clearStreamingState: () => void;
}

export function useMessageQueue({
  sessionRef,
  setMessages,
  markActivityRef,
}: UseMessageQueueParams): UseMessageQueueResult {
  const queueRef = useRef<QueueEntry[]>([]);
  const processingRef = useRef(false);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [selectedQueueIndex, setSelectedQueueIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallData[]>([]);
  const [streamStartedAt, setStreamStartedAt] = useState<Date | null>(null);
  const [preparingTool, setPreparingTool] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [usage, setUsage] = useState<ContextUsage | null>(null);

  const syncQueue = useCallback(() => {
    const snapshot = queueRef.current.map((e) => e.display);
    setQueuedMessages(snapshot);
    setSelectedQueueIndex((prev) =>
      snapshot.length === 0 ? 0 : Math.min(prev, snapshot.length - 1),
    );
  }, []);

  const clearStreamingState = useCallback(() => {
    setStreamingText("");
    setActiveToolCalls([]);
    setPreparingTool(null);
    setStreamStartedAt(null);
  }, []);

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
      setStreamStartedAt(new Date());

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
          setStreamStartedAt(new Date());
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
            pendingToolCalls = [...pendingToolCalls, tc];
            setActiveToolCalls(pendingToolCalls);
            setPreparingTool(null);
          },
          onToolEnd: (id, _name, output, isError, meta) => {
            markActivityRef.current();
            // Replace the matched entry with a new object so its identity
            // changes (memoized ToolCall children rely on this); other entries
            // keep their reference and skip re-render.
            pendingToolCalls = pendingToolCalls.map((t) =>
              t.id === id
                ? {
                    ...t,
                    running: false,
                    output,
                    isError,
                    ...(meta?.largeResult
                      ? { largeResult: meta.largeResult }
                      : {}),
                  }
                : t,
            );
            setActiveToolCalls(pendingToolCalls);
          },
          onToolNotify: (id, message) => {
            markActivityRef.current();
            let touched = false;
            pendingToolCalls = pendingToolCalls.map((t) => {
              if (t.id !== id) return t;
              touched = true;
              return { ...t, notes: [...(t.notes ?? []), message] };
            });
            if (touched) setActiveToolCalls(pendingToolCalls);
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
        setStreamStartedAt(null);
      }
    }

    setIsLoading(false);
    processingRef.current = false;
  }, [sessionRef, setMessages, markActivityRef, syncQueue]);

  return {
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
  };
}
