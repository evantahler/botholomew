import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import type { Task } from "../db/tasks.ts";
import { logInteraction } from "../db/threads.ts";
import { registerAllTools } from "../tools/registry.ts";
import { getTool, type ToolContext, toAnthropicTools } from "../tools/tool.ts";
import { fitToContextWindow, getMaxInputTokens } from "./context.ts";
import { clearLargeResults, maybeStoreResult } from "./large-results.ts";

registerAllTools();

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
  conn: DbConnection;
  threadId: string;
  projectDir: string;
  mcpxClient?: McpxClient | null;
}): Promise<AgentLoopResult> {
  const { systemPrompt, task, config, conn, threadId, projectDir } = input;

  const client = new Anthropic({
    apiKey: config.anthropic_api_key || undefined,
  });

  const toolCtx: ToolContext = {
    conn,
    projectDir,
    config,
    mcpxClient: input.mcpxClient ?? null,
  };

  const userMessage = `Task:\nName: ${task.name}\nDescription: ${task.description}\nPriority: ${task.priority}`;

  const messages: MessageParam[] = [{ role: "user", content: userMessage }];

  // Log the initial user message
  await logInteraction(conn, threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  clearLargeResults();
  const daemonTools = toAnthropicTools();
  const maxInputTokens = await getMaxInputTokens(
    config.anthropic_api_key,
    config.model,
  );

  const maxTurns = config.max_turns;
  for (let turn = 0; !maxTurns || turn < maxTurns; turn++) {
    const startTime = Date.now();
    fitToContextWindow(messages, systemPrompt, maxInputTokens);
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: daemonTools,
    });
    const durationMs = Date.now() - startTime;
    const tokenCount =
      response.usage.input_tokens + response.usage.output_tokens;

    // Log assistant text blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        await logInteraction(conn, threadId, {
          role: "assistant",
          kind: "message",
          content: block.text,
          durationMs,
          tokenCount,
        });
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
      await logInteraction(conn, threadId, {
        role: "assistant",
        kind: "tool_use",
        content: `Calling ${toolUse.name}`,
        toolName: toolUse.name,
        toolInput: JSON.stringify(toolUse.input),
      });
    }

    // Execute all tools in parallel
    const execResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const start = Date.now();
        const result = await executeToolCall(toolUse, toolCtx);
        return { toolUse, result, durationMs: Date.now() - start };
      }),
    );

    // Log results and collect tool_result messages
    const toolResults: ToolResultBlockParam[] = [];
    for (const { toolUse, result, durationMs } of execResults) {
      await logInteraction(conn, threadId, {
        role: "tool",
        kind: "tool_result",
        content: result.output,
        toolName: toolUse.name,
        durationMs,
      });

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

async function executeToolCall(
  toolUse: ToolUseBlock,
  ctx: ToolContext,
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
    return {
      output: `Invalid input: ${JSON.stringify(parsed.error)}`,
      terminal: false,
      isError: true,
    };
  }

  const result = await tool.execute(parsed.data, ctx);
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
