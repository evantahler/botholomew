import { useEffect, useRef, useState } from "react";
import { getWebSocketClient, type StreamingChunk } from "../lib/websocket";
import type { AgentRunStreaming } from "../../backend/actions/agent";

export type StreamingStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "completed"
  | "failed";

export type StreamingResult = {
  status: StreamingStatus;
  accumulated: string;
  chunks: string[];
  error?: string;
  finalResult?: {
    status: string;
    result?: string;
    rationale?: string;
    error?: string;
  };
};

export function useStreamingAgentRun() {
  const [result, setResult] = useState<StreamingResult>({
    status: "idle",
    accumulated: "",
    chunks: [],
  });

  const wsClientRef = useRef(getWebSocketClient());
  const messageIdRef = useRef<string | number | null>(null);
  const accumulatedRef = useRef("");

  useEffect(() => {
    const wsClient = wsClientRef.current;

    wsClient.onError((error) => {
      setResult((prev) => ({
        ...prev,
        status: "failed",
        error: error.message,
      }));
    });

    return () => {
      // Cleanup: remove message handler if active
      if (messageIdRef.current) {
        wsClient.removeStreamingHandler(messageIdRef.current);
      }
    };
  }, []);

  const streamAgentRun = async (
    agentId: number,
    additionalContext?: string,
  ): Promise<void> => {
    const wsClient = wsClientRef.current;
    const messageId = Date.now();

    // Reset state
    accumulatedRef.current = "";
    setResult({
      status: "connecting",
      accumulated: "",
      chunks: [],
    });

    messageIdRef.current = messageId;

    try {
      // Ensure connection
      if (!wsClient.isConnected()) {
        setResult((prev) => ({ ...prev, status: "connecting" }));
        await wsClient.connect();
      }

      // Set up message handler
      wsClient.onStreamingMessage(messageId, (chunk: StreamingChunk) => {
        if (chunk.type === "stream:start") {
          setResult((prev) => ({
            ...prev,
            status: "streaming",
          }));
        } else if (chunk.type === "stream:chunk") {
          const data = chunk.data;
          if (data?.chunk) {
            accumulatedRef.current += data.chunk;
            setResult((prev) => ({
              ...prev,
              status: "streaming",
              accumulated: accumulatedRef.current,
              chunks: [...prev.chunks, data.chunk],
            }));
          } else if (data?.accumulated) {
            accumulatedRef.current = data.accumulated;
            setResult((prev) => ({
              ...prev,
              status: "streaming",
              accumulated: accumulatedRef.current,
            }));
          } else if (data?.status) {
            // Status update
            setResult((prev) => ({
              ...prev,
              status: data.status === "completed" ? "completed" : "streaming",
            }));
          }
        } else if (chunk.type === "stream:done") {
          const data = chunk.data;
          setResult((prev) => ({
            ...prev,
            status: "completed",
            finalResult: {
              status: data?.status || "completed",
              result: data?.result || accumulatedRef.current,
              rationale: data?.rationale,
              error: data?.error,
            },
          }));
          wsClient.removeStreamingHandler(messageId);
          messageIdRef.current = null;
        } else if (chunk.type === "stream:error") {
          setResult((prev) => ({
            ...prev,
            status: "failed",
            error: chunk.error?.message || "Streaming error occurred",
          }));
          wsClient.removeStreamingHandler(messageId);
          messageIdRef.current = null;
        }
      });

      // Send action message
      wsClient.send({
        messageType: "action",
        messageId,
        action: "agent:run:stream",
        params: {
          id: agentId,
          additionalContext,
          messageId,
        },
      });
    } catch (error) {
      setResult((prev) => ({
        ...prev,
        status: "failed",
        error: error instanceof Error ? error.message : "Failed to start streaming",
      }));
      if (messageIdRef.current) {
        wsClient.removeStreamingHandler(messageIdRef.current);
        messageIdRef.current = null;
      }
    }
  };

  const reset = () => {
    if (messageIdRef.current) {
      wsClientRef.current.removeStreamingHandler(messageIdRef.current);
      messageIdRef.current = null;
    }
    accumulatedRef.current = "";
    setResult({
      status: "idle",
      accumulated: "",
      chunks: [],
    });
  };

  return {
    result,
    streamAgentRun,
    reset,
    isStreaming: result.status === "streaming" || result.status === "connecting",
  };
}
