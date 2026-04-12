import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolUseBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { DuckDBConnection } from "../db/connection.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { Task } from "../db/tasks.ts";
import { logInteraction } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";
import {
  getTool,
  toAnthropicTools,
  type ToolContext,
} from "../tools/tool.ts";
import { registerAllTools } from "../tools/registry.ts";

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
  conn: DuckDBConnection;
  threadId: string;
  projectDir: string;
}): Promise<AgentLoopResult> {
  const { systemPrompt, task, config, conn, threadId, projectDir } = input;

  const client = new Anthropic({
    apiKey: config.anthropic_api_key || undefined,
  });

  const toolCtx: ToolContext = { conn, projectDir, config };

  const userMessage = `Please work on this task:\n\nName: ${task.name}\nDescription: ${task.description}\nPriority: ${task.priority}\n\nUse the available tools to complete this task, then call complete_task, fail_task, or wait_task to indicate the outcome.`;

  const messages: MessageParam[] = [{ role: "user", content: userMessage }];

  // Log the initial user message
  await logInteraction(conn, threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  const daemonTools = toAnthropicTools();

  const maxTurns = 10;
  for (let turn = 0; turn < maxTurns; turn++) {
    const startTime = Date.now();
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

    // Process each tool call
    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolInput = JSON.stringify(toolUse.input);

      // Log tool use
      await logInteraction(conn, threadId, {
        role: "assistant",
        kind: "tool_use",
        content: `Calling ${toolUse.name}`,
        toolName: toolUse.name,
        toolInput,
      });

      const toolStart = Date.now();
      const result = await executeToolCall(toolUse, toolCtx);
      const toolDuration = Date.now() - toolStart;

      // Log tool result
      await logInteraction(conn, threadId, {
        role: "tool",
        kind: "tool_result",
        content: result.output,
        toolName: toolUse.name,
        durationMs: toolDuration,
      });

      if (result.terminal) {
        return result.agentResult!;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.output,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { status: "failed", reason: "Max turns exceeded" };
}

interface ToolCallResult {
  output: string;
  terminal: boolean;
  agentResult?: AgentLoopResult;
}

async function executeToolCall(
  toolUse: ToolUseBlock,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const tool = getTool(toolUse.name);
  if (!tool) {
    return { output: `Unknown tool: ${toolUse.name}`, terminal: false };
  }

  const parsed = tool.inputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      output: `Invalid input: ${JSON.stringify(parsed.error)}`,
      terminal: false,
    };
  }

  const result = await tool.execute(parsed.data, ctx);
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
        agentResult: { status, reason: String(reason) },
      };
    }
  }

  return { output, terminal: false };
}
