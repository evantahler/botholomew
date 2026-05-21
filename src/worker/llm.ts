import type { McpxClient } from "@evantahler/mcpx";
import type { ModelMessage, ToolCallPart } from "ai";
import { streamText } from "ai";
import type { BotholomewConfig } from "../config/schemas.ts";
import {
  createAbortHandle,
  describeModel,
  extractCacheTokens,
  getLanguageModel,
  toAiSdkTools,
  withAnthropicCacheBreakpoints,
} from "../llm/index.ts";
import type { WithMem } from "../mem/client.ts";
import type { Task } from "../tasks/schema.ts";
import { getTask } from "../tasks/store.ts";
import { logInteraction } from "../threads/store.ts";
import { registerAllTools } from "../tools/registry.ts";
import { getAllTools, getTool, type ToolContext } from "../tools/tool.ts";
import { logger } from "../utils/logger.ts";
import { fitToContextWindow, getMaxInputTokens } from "./context.ts";
import { clearLargeResults, maybeStoreResult } from "./large-results.ts";

registerAllTools();

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export interface WorkerStreamCallbacks {
  onToken: (text: string) => void;
  onToolStart: (name: string, input: string) => void;
  onToolEnd: (
    name: string,
    output: string,
    isError: boolean,
    durationMs: number,
  ) => void;
  onTaskStart: (task: Task) => void;
}

export interface AgentLoopResult {
  status: "complete" | "failed" | "waiting";
  reason?: string;
}

const STATUS_MAP: Record<string, AgentLoopResult["status"]> = {
  complete_task: "complete",
  fail_task: "failed",
  wait_task: "waiting",
};

interface CollectedToolCall {
  id: string;
  name: string;
  input: unknown;
}

export async function runAgentLoop(input: {
  systemPrompt: string;
  task: Task;
  config: BotholomewConfig;
  withMem: WithMem;
  threadId: string;
  projectDir: string;
  workerId?: string;
  mcpxClient?: McpxClient | null;
  callbacks?: WorkerStreamCallbacks;
}): Promise<AgentLoopResult> {
  const {
    systemPrompt,
    task,
    config,
    withMem,
    threadId,
    projectDir,
    workerId,
    callbacks,
  } = input;

  const model = getLanguageModel(config.llm);

  // Build predecessor context from completed blocking tasks
  let predecessorContext = "";
  if (task.blocked_by.length > 0) {
    const predecessorOutputs: string[] = [];
    for (const blockerId of task.blocked_by) {
      const blocker = await getTask(projectDir, blockerId);
      if (blocker?.output) {
        predecessorOutputs.push(
          `### ${blocker.name} (${blocker.id})\n${blocker.output}`,
        );
      }
    }
    if (predecessorOutputs.length > 0) {
      predecessorContext = `\n\nPredecessor Task Outputs:\n${predecessorOutputs.join("\n\n")}`;
    }
  }

  const userMessage = `Task:\nName: ${task.name}\nDescription: ${task.description}\nPriority: ${task.priority}${predecessorContext}`;

  const messages: ModelMessage[] = [{ role: "user", content: userMessage }];

  await logInteraction(projectDir, threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  clearLargeResults();
  const workerTools = toAiSdkTools(getAllTools());
  const maxInputTokens = await getMaxInputTokens(config.llm);

  const maxTurns = config.max_turns;
  for (let turn = 0; !maxTurns || turn < maxTurns; turn++) {
    const startTime = Date.now();
    fitToContextWindow(messages, systemPrompt, maxInputTokens);

    const wrapped = withAnthropicCacheBreakpoints({
      provider: config.llm.provider,
      system: systemPrompt,
      messages,
      tools: workerTools,
    });

    const abortHandle = createAbortHandle();
    const result = streamText({
      model,
      system: wrapped.system,
      messages: wrapped.messages,
      tools: wrapped.tools,
      maxOutputTokens: 4096,
      abortSignal: abortHandle.signal,
    });

    let streamedText = "";
    const collectedToolCalls: CollectedToolCall[] = [];

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            streamedText += part.text;
            callbacks?.onToken(part.text);
            break;
          case "tool-call":
            collectedToolCalls.push({
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            });
            break;
          case "error":
            throw part.error;
        }
      }
    } catch (err) {
      logger.error(`Worker LLM stream failed: ${err}`);
      return { status: "failed", reason: `LLM error: ${err}` };
    }

    if (streamedText && callbacks) {
      callbacks.onToken("\n");
    }

    const usage = await result.usage;
    const providerMeta = await result.providerMetadata;
    const cacheTokens = extractCacheTokens(usage, providerMeta);
    const tokenCount = cacheTokens.input + cacheTokens.output;
    const durationMs = Date.now() - startTime;

    if (streamedText) {
      await logInteraction(projectDir, threadId, {
        role: "assistant",
        kind: "message",
        content: streamedText,
        durationMs,
        tokenCount,
      });
      if (!callbacks) {
        logger.phase("assistant", streamedText);
      }
    }

    if (collectedToolCalls.length === 0) {
      return {
        status: "complete",
        reason: "Agent completed without explicit status tool call",
      };
    }

    // Append the assistant turn (text + tool calls) to the conversation.
    const assistantContent: Array<
      ToolCallPart | { type: "text"; text: string }
    > = [];
    if (streamedText) {
      assistantContent.push({ type: "text", text: streamedText });
    }
    for (const tc of collectedToolCalls) {
      assistantContent.push({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.input,
      });
    }
    messages.push({ role: "assistant", content: assistantContent });

    for (const tc of collectedToolCalls) {
      const toolInput = JSON.stringify(tc.input);
      callbacks?.onToolStart(tc.name, toolInput);
      if (!callbacks) {
        logger.phase("tool-call", `${tc.name} ${truncate(toolInput, 200)}`);
      }
      await logInteraction(projectDir, threadId, {
        role: "assistant",
        kind: "tool_use",
        content: `Calling ${tc.name}`,
        toolName: tc.name,
        toolInput,
      });
    }

    const execResults = await Promise.all(
      collectedToolCalls.map(async (tc) => {
        const start = Date.now();
        const result = await executeToolCall(tc, {
          withMem,
          projectDir,
          config,
          mcpxClient: input.mcpxClient ?? null,
          workerId,
        });
        const elapsed = Date.now() - start;
        callbacks?.onToolEnd(tc.name, result.output, result.isError, elapsed);
        return { toolCall: tc, result, durationMs: elapsed };
      }),
    );

    const toolResultContent: Array<{
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output:
        | { type: "text"; value: string }
        | { type: "error-text"; value: string };
    }> = [];

    for (const { toolCall, result, durationMs } of execResults) {
      await logInteraction(projectDir, threadId, {
        role: "tool",
        kind: "tool_result",
        content: result.output,
        toolName: toolCall.name,
        durationMs,
      });
      if (!callbacks) {
        const seconds = (durationMs / 1000).toFixed(1);
        const status = result.isError ? "err" : "ok";
        logger.phase(
          "tool-result",
          `${toolCall.name} ${status} in ${seconds}s`,
        );
      }

      if (result.terminal && result.agentResult) {
        return result.agentResult;
      }

      const stored = maybeStoreResult(toolCall.name, result.output);
      toolResultContent.push({
        type: "tool-result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: result.isError
          ? { type: "error-text", value: stored.text }
          : { type: "text", value: stored.text },
      });
    }

    messages.push({ role: "tool", content: toolResultContent });

    // Touch describeModel so the import isn't flagged unused on a clean build.
    void describeModel;
  }

  return { status: "failed", reason: "Max turns exceeded" };
}

interface ToolCallResult {
  output: string;
  terminal: boolean;
  isError: boolean;
  agentResult?: AgentLoopResult;
}

interface ToolCallCtx {
  withMem: WithMem;
  projectDir: string;
  config: BotholomewConfig;
  mcpxClient: McpxClient | null;
  workerId?: string;
}

async function executeToolCall(
  toolCall: CollectedToolCall,
  baseCtx: ToolCallCtx,
): Promise<ToolCallResult> {
  const tool = getTool(toolCall.name);
  if (!tool) {
    return {
      output: `Unknown tool: ${toolCall.name}`,
      terminal: false,
      isError: true,
    };
  }

  const parsed = tool.inputSchema.safeParse(toolCall.input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      output: `Invalid input for ${toolCall.name}: ${issues}. Check the tool's expected parameters.`,
      terminal: false,
      isError: true,
    };
  }

  let result: unknown;
  try {
    const ctx: ToolContext = baseCtx;
    result = await tool.execute(parsed.data, ctx);
  } catch (err) {
    return {
      output: `Tool ${toolCall.name} threw an error: ${err}. You may retry with different parameters or try an alternative approach.`,
      terminal: false,
      isError: true,
    };
  }
  const isError =
    typeof result === "object" && result !== null && "is_error" in result
      ? (result as { is_error: boolean }).is_error
      : false;
  const output = typeof result === "string" ? result : JSON.stringify(result);

  if (tool.terminal) {
    const status = STATUS_MAP[tool.name];
    if (status) {
      const reason =
        (parsed.data as Record<string, unknown>).summary ??
        (parsed.data as Record<string, unknown>).reason ??
        "";
      return {
        output,
        terminal: true,
        isError,
        agentResult: { status, reason: String(reason) },
      };
    }
  }

  return { output, terminal: false, isError };
}
