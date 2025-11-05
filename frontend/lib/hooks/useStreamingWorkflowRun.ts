import { useEffect, useRef, useState } from "react";
import { getWebSocketClient, type StreamingChunk } from "../websocket";

export type WorkflowStreamingStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "step_streaming"
  | "completed"
  | "failed";

export type WorkflowStreamingResult = {
  status: WorkflowStreamingStatus;
  message?: string;
  workflowRun?: any;
  currentStep?: {
    stepIndex: number;
    stepId: number;
    agentId?: number;
    agentName?: string;
    output?: string;
    rationale?: string;
    accumulated?: string;
  };
  error?: string;
};

export function useStreamingWorkflowRun() {
  const [result, setResult] = useState<WorkflowStreamingResult>({
    status: "idle",
  });

  const wsClientRef = useRef(getWebSocketClient());
  const messageIdRef = useRef<string | number | null>(null);
  const currentStepOutputRef = useRef<Record<number, string>>({});

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

  const streamWorkflowTick = async (
    workflowId: number,
    runId: number,
  ): Promise<void> => {
    const wsClient = wsClientRef.current;
    const messageId = Date.now();

    // Reset state
    currentStepOutputRef.current = {};
    setResult({
      status: "connecting",
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
          
          if (data?.status === "step_starting") {
            setResult((prev) => ({
              ...prev,
              status: "step_streaming",
              message: data.message,
              currentStep: {
                stepIndex: data.stepIndex,
                stepId: data.stepId,
                agentId: data.agentId,
                agentName: data.agentName,
                output: "",
              },
            }));
          } else if (data?.stepIndex !== undefined) {
            // Step streaming update
            const stepIndex = data.stepIndex;
            const stepOutput = data.stepOutput || data.accumulated || "";
            
            if (stepOutput) {
              currentStepOutputRef.current[stepIndex] = stepOutput;
            }

            setResult((prev) => ({
              ...prev,
              status: "step_streaming",
              message: data.message,
              currentStep: {
                stepIndex: data.stepIndex,
                stepId: data.stepId,
                output: currentStepOutputRef.current[stepIndex] || stepOutput,
                rationale: data.stepRationale || prev.currentStep?.rationale,
                accumulated: data.accumulated || stepOutput,
              },
              workflowRun: data.workflowRun || prev.workflowRun,
            }));
          } else if (data?.status === "step_completed") {
            setResult((prev) => ({
              ...prev,
              status: "streaming",
              message: data.message,
              currentStep: {
                stepIndex: data.stepIndex,
                stepId: data.stepId,
                output: data.stepOutput,
                rationale: data.stepRationale,
              },
              workflowRun: data.workflowRun,
            }));
          } else if (data?.workflowRun) {
            // Workflow-level update
            setResult((prev) => ({
              ...prev,
              status: data.status === "completed" ? "completed" : "streaming",
              message: data.message,
              workflowRun: data.workflowRun,
            }));
          } else {
            // Generic status update
            setResult((prev) => ({
              ...prev,
              status: data.status === "completed" ? "completed" : "streaming",
              message: data.message,
            }));
          }
        } else if (chunk.type === "stream:done") {
          const data = chunk.data;
          setResult((prev) => ({
            ...prev,
            status: "completed",
            message: data?.message || "Workflow step completed",
            workflowRun: data?.workflowRun || prev.workflowRun,
          }));
          wsClient.removeStreamingHandler(messageId);
          messageIdRef.current = null;
        } else if (chunk.type === "stream:error") {
          setResult((prev) => ({
            ...prev,
            status: "failed",
            error: chunk.error?.message || "Streaming error occurred",
            workflowRun: chunk.data?.workflowRun || prev.workflowRun,
          }));
          wsClient.removeStreamingHandler(messageId);
          messageIdRef.current = null;
        }
      });

      // Send action message
      wsClient.send({
        messageType: "action",
        messageId,
        action: "workflow:run:tick:stream",
        params: {
          id: workflowId,
          runId,
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
    currentStepOutputRef.current = {};
    setResult({
      status: "idle",
    });
  };

  return {
    result,
    streamWorkflowTick,
    reset,
    isStreaming:
      result.status === "streaming" ||
      result.status === "step_streaming" ||
      result.status === "connecting",
  };
}
