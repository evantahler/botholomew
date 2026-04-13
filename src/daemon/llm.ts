import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { DuckDBConnection } from "../db/connection.ts";
import type { Task } from "../db/tasks.ts";
import { createTask } from "../db/tasks.ts";
import { logInteraction } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";

const DAEMON_TOOLS: Tool[] = [
  {
    name: "complete_task",
    description:
      "Mark the current task as complete with a summary of what was accomplished.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Summary of work done" },
      },
      required: ["summary"],
    },
  },
  {
    name: "fail_task",
    description: "Mark the current task as failed with a reason.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "Why the task failed" },
      },
      required: ["reason"],
    },
  },
  {
    name: "wait_task",
    description:
      "Put the task in waiting status (e.g., needs human input, rate limited).",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why the task is waiting",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "create_task",
    description: "Create a new task to be worked on later.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Task name" },
        description: { type: "string", description: "Task description" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Task priority",
        },
        blocked_by: {
          type: "array",
          items: { type: "string" },
          description: "IDs of tasks that must complete first",
        },
      },
      required: ["name"],
    },
  },
];

export interface AgentLoopResult {
  status: "complete" | "failed" | "waiting";
  reason?: string;
}

export async function runAgentLoop(input: {
  systemPrompt: string;
  task: Task;
  config: Required<BotholomewConfig>;
  conn: DuckDBConnection;
  threadId: string;
}): Promise<AgentLoopResult> {
  const { systemPrompt, task, config, conn, threadId } = input;

  const client = new Anthropic({
    apiKey: config.anthropic_api_key || undefined,
  });

  const userMessage = `Please work on this task:\n\nName: ${task.name}\nDescription: ${task.description}\nPriority: ${task.priority}\n\nUse the available tools to complete this task, then call complete_task, fail_task, or wait_task to indicate the outcome.`;

  const messages: MessageParam[] = [{ role: "user", content: userMessage }];

  // Log the initial user message
  await logInteraction(conn, threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  const maxTurns = 10;
  for (let turn = 0; turn < maxTurns; turn++) {
    const startTime = Date.now();
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: DAEMON_TOOLS,
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
      const result = await executeToolCall(toolUse, conn);
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
  conn: DuckDBConnection,
): Promise<ToolCallResult> {
  const input = toolUse.input as Record<string, unknown>;

  switch (toolUse.name) {
    case "complete_task":
      return {
        output: `Task completed: ${input.summary}`,
        terminal: true,
        agentResult: {
          status: "complete",
          reason: String(input.summary ?? ""),
        },
      };

    case "fail_task":
      return {
        output: `Task failed: ${input.reason}`,
        terminal: true,
        agentResult: {
          status: "failed",
          reason: String(input.reason ?? ""),
        },
      };

    case "wait_task":
      return {
        output: `Task waiting: ${input.reason}`,
        terminal: true,
        agentResult: {
          status: "waiting",
          reason: String(input.reason ?? ""),
        },
      };

    case "create_task": {
      const newTask = await createTask(conn, {
        name: String(input.name),
        description: input.description ? String(input.description) : undefined,
        priority: input.priority as Task["priority"] | undefined,
        blocked_by: input.blocked_by as string[] | undefined,
      });
      logger.info(`Created subtask: ${newTask.name} (${newTask.id})`);
      return {
        output: `Created task "${newTask.name}" with ID ${newTask.id}`,
        terminal: false,
      };
    }

    default:
      return {
        output: `Unknown tool: ${toolUse.name}`,
        terminal: false,
      };
  }
}
