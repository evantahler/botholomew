import type {
  Message,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import { withDb } from "../db/connection.ts";
import type { Task } from "../tasks/schema.ts";
import { getTask } from "../tasks/store.ts";
import { logInteraction } from "../threads/store.ts";
import { registerAllTools } from "../tools/registry.ts";
import { getTool, type ToolContext, toAnthropicTools } from "../tools/tool.ts";
import { logger } from "../utils/logger.ts";
import { fitToContextWindow, getMaxInputTokens } from "./context.ts";
import { clearLargeResults, maybeStoreResult } from "./large-results.ts";
import { createLlmClient } from "./llm-client.ts";

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

export async function runAgentLoop(input: {
  systemPrompt: string;
  task: Task;
  config: Required<BotholomewConfig>;
  dbPath: string;
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
    dbPath,
    threadId,
    projectDir,
    workerId,
    callbacks,
  } = input;

  const client = createLlmClient(config);

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

  const messages: MessageParam[] = [{ role: "user", content: userMessage }];

  // Log the initial user message
  await logInteraction(projectDir, threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  clearLargeResults();
  const workerTools = toAnthropicTools();
  const maxInputTokens = await getMaxInputTokens(
    config.anthropic_api_key,
    config.model,
  );

  const maxTurns = config.max_turns;
  for (let turn = 0; !maxTurns || turn < maxTurns; turn++) {
    const startTime = Date.now();
    fitToContextWindow(messages, systemPrompt, maxInputTokens);

    let response: Message;
    let streamedText = "";

    if (callbacks) {
      const stream = client.messages.stream({
        model: config.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: workerTools,
      });

      stream.on("text", (text) => {
        streamedText += text;
        callbacks.onToken(text);
      });

      response = await stream.finalMessage();

      // Ensure a newline after streamed text before tool output
      if (streamedText) {
        callbacks.onToken("\n");
      }
    } else {
      response = await client.messages.create({
        model: config.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: workerTools,
      });
    }

    const durationMs = Date.now() - startTime;
    const tokenCount =
      response.usage.input_tokens + response.usage.output_tokens;

    // Log assistant text blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        await logInteraction(projectDir, threadId, {
          role: "assistant",
          kind: "message",
          content: block.text,
          durationMs,
          tokenCount,
        });
        if (!callbacks) {
          logger.phase("assistant", block.text);
        }
      }
    }

    // Check for end turn with no tool use
    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      return {
        status: "complete",
        reason: "Agent completed without explicit status tool call",
      };
    }

    // Add assistant response to conversation
    messages.push({ role: "assistant", content: response.content });

    // Log all tool_use entries
    for (const toolUse of toolUseBlocks) {
      const toolInput = JSON.stringify(toolUse.input);
      callbacks?.onToolStart(toolUse.name, toolInput);
      if (!callbacks) {
        logger.phase(
          "tool-call",
          `${toolUse.name} ${truncate(toolInput, 200)}`,
        );
      }
      await logInteraction(projectDir, threadId, {
        role: "assistant",
        kind: "tool_use",
        content: `Calling ${toolUse.name}`,
        toolName: toolUse.name,
        toolInput,
      });
    }

    // Execute all tools in parallel. Each tool call opens its own short-lived
    // connection (or none, if the tool uses dbPath internally) via
    // executeToolCall — so parallel tool calls share the process-local
    // DuckDB instance and release the file lock as soon as they finish.
    const execResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const start = Date.now();
        const result = await executeToolCall(toolUse, {
          dbPath,
          projectDir,
          config,
          mcpxClient: input.mcpxClient ?? null,
          workerId,
        });
        const elapsed = Date.now() - start;
        callbacks?.onToolEnd(
          toolUse.name,
          result.output,
          result.isError,
          elapsed,
        );
        return { toolUse, result, durationMs: elapsed };
      }),
    );

    // Log results and collect tool_result messages
    const toolResults: ToolResultBlockParam[] = [];
    for (const { toolUse, result, durationMs } of execResults) {
      await logInteraction(projectDir, threadId, {
        role: "tool",
        kind: "tool_result",
        content: result.output,
        toolName: toolUse.name,
        durationMs,
      });
      if (!callbacks) {
        const seconds = (durationMs / 1000).toFixed(1);
        const status = result.isError ? "err" : "ok";
        logger.phase("tool-result", `${toolUse.name} ${status} in ${seconds}s`);
      }

      if (result.terminal && result.agentResult) {
        return result.agentResult;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: maybeStoreResult(toolUse.name, result.output).text,
        is_error: result.isError || undefined,
      });
    }

    messages.push({ role: "user", content: toolResults });
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
  dbPath: string;
  projectDir: string;
  config: Required<BotholomewConfig>;
  mcpxClient: McpxClient | null;
  workerId?: string;
}

async function executeToolCall(
  toolUse: ToolUseBlock,
  baseCtx: ToolCallCtx,
): Promise<ToolCallResult> {
  const tool = getTool(toolUse.name);
  if (!tool) {
    return {
      output: `Unknown tool: ${toolUse.name}`,
      terminal: false,
      isError: true,
    };
  }

  const parsed = tool.inputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      output: `Invalid input for ${toolUse.name}: ${issues}. Check the tool's expected parameters.`,
      terminal: false,
      isError: true,
    };
  }

  let result: unknown;
  try {
    result = await withDb(baseCtx.dbPath, (conn) => {
      const ctx: ToolContext = { ...baseCtx, conn };
      return tool.execute(parsed.data, ctx);
    });
  } catch (err) {
    return {
      output: `Tool ${toolUse.name} threw an error: ${err}. You may retry with different parameters or try an alternative approach.`,
      terminal: false,
      isError: true,
    };
  }
  const isError =
    typeof result === "object" && result !== null && "is_error" in result
      ? (result as { is_error: boolean }).is_error
      : false;
  const output = typeof result === "string" ? result : JSON.stringify(result);

  // Check if this is a terminal tool (complete/fail/wait)
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
