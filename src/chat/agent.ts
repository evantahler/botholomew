import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { BotholomewConfig } from "../config/schemas.ts";
import { embedSingle } from "../context/embedder.ts";
import { fitToContextWindow, getMaxInputTokens } from "../daemon/context.ts";
import { maybeStoreResult } from "../daemon/large-results.ts";
import { createLlmClient } from "../daemon/llm-client.ts";
import {
  buildMetaHeader,
  extractKeywords,
  loadPersistentContext,
} from "../daemon/prompt.ts";
import type { DbConnection } from "../db/connection.ts";
import { hybridSearch } from "../db/embeddings.ts";
import { logInteraction } from "../db/threads.ts";
import { registerAllTools } from "../tools/registry.ts";
import {
  getAllTools,
  getTool,
  type ToolContext,
  toAnthropicTool,
} from "../tools/tool.ts";
import { logger } from "../utils/logger.ts";

registerAllTools();

/** Tools available in chat mode — no daemon terminal tools, no destructive file tools */
const CHAT_TOOL_NAMES = new Set([
  "create_task",
  "list_tasks",
  "view_task",
  "context_search",
  "search_grep",
  "search_semantic",
  "list_threads",
  "view_thread",
  "create_schedule",
  "list_schedules",
  "update_beliefs",
  "update_goals",
  "mcp_list_tools",
  "mcp_search",
  "mcp_info",
  "mcp_exec",
  "read_large_result",
]);

export function getChatTools() {
  return getAllTools()
    .filter((t) => CHAT_TOOL_NAMES.has(t.name))
    .map(toAnthropicTool);
}

export async function buildChatSystemPrompt(
  projectDir: string,
  options?: {
    keywordSource?: string;
    conn?: DbConnection;
    config?: Required<BotholomewConfig>;
  },
): Promise<string> {
  const parts: string[] = [];

  parts.push(...buildMetaHeader(projectDir));

  const keywordSource = options?.keywordSource?.trim();
  const taskKeywords = keywordSource ? extractKeywords(keywordSource) : null;

  parts.push(...(await loadPersistentContext(projectDir, taskKeywords)));

  // Relevant context from embeddings search
  const conn = options?.conn;
  const config = options?.config;
  if (conn && config?.openai_api_key && keywordSource) {
    try {
      const queryVec = await embedSingle(keywordSource, config);
      const results = await hybridSearch(conn, keywordSource, queryVec, 5);

      if (results.length > 0) {
        parts.push("## Relevant Context");
        for (const r of results) {
          const path = r.source_path || r.context_item_id;
          parts.push(`### ${r.title} (${path})`);
          if (r.chunk_content) {
            parts.push(r.chunk_content.slice(0, 1000));
          }
          parts.push("");
        }
      }
    } catch (err) {
      logger.debug(`Failed to load contextual embeddings: ${err}`);
    }
  }

  parts.push("## Instructions");
  parts.push(
    "You are Botholomew, an AI agent personified by a wise owl. This is your interactive chat interface. Help the user manage tasks, review results from daemon activity, search context, and answer questions.",
  );
  parts.push(
    "You do NOT execute long-running work directly — enqueue tasks for the daemon instead using create_task.",
  );
  parts.push(
    "Use the available tools to look up tasks, threads, schedules, and context when the user asks about them.",
  );
  parts.push(
    "When multiple tool calls are independent of each other (i.e., one does not depend on the result of another), call them all in a single response. They will be executed in parallel, which is faster than calling them one at a time.",
  );
  parts.push(
    "You can update the agent's beliefs and goals files when the user asks you to.",
  );
  parts.push(
    "Format your responses using Markdown. Use headings, bold, italic, lists, and code blocks to make your responses clear and well-structured.",
  );
  parts.push("");

  return parts.join("\n");
}

export interface ToolEndMeta {
  largeResult?: { id: string; chars: number; pages: number };
}

export interface ChatTurnCallbacks {
  onToken: (text: string) => void;
  onToolStart: (id: string, name: string, input: string) => void;
  onToolEnd: (
    id: string,
    name: string,
    output: string,
    isError: boolean,
    meta?: ToolEndMeta,
  ) => void;
}

/**
 * Walk messages backward to find the most recent human-authored user message.
 * After tool turns, `messages[messages.length - 1]` is a user entry whose
 * content is a `ToolResultBlockParam[]` — we want the string content from the
 * actual user, not tool output, as the keyword source.
 */
function findLastUserText(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/**
 * Run a single chat turn: stream the assistant response, execute any tool calls,
 * and loop until the model produces end_turn with no tool calls.
 * Mutates `messages` in-place by appending assistant/tool messages.
 */
export async function runChatTurn(input: {
  messages: MessageParam[];
  projectDir: string;
  config: Required<BotholomewConfig>;
  conn: DbConnection;
  threadId: string;
  toolCtx: ToolContext;
  callbacks: ChatTurnCallbacks;
}): Promise<void> {
  const { messages, projectDir, config, conn, threadId, toolCtx, callbacks } =
    input;

  const client = createLlmClient(config);

  const chatTools = getChatTools();
  const maxInputTokens = await getMaxInputTokens(
    config.anthropic_api_key,
    config.model,
  );
  const maxTurns = config.max_turns;

  for (let turn = 0; !maxTurns || turn < maxTurns; turn++) {
    const startTime = Date.now();

    // Rebuild the system prompt every iteration so that:
    //   (1) `loading: contextual` files get matched against the latest user
    //       message, and
    //   (2) any update_beliefs / update_goals tool call in the previous
    //       iteration is reflected in the next LLM call.
    const keywordSource = findLastUserText(messages);
    const systemPrompt = await buildChatSystemPrompt(projectDir, {
      keywordSource,
      conn,
      config,
    });

    fitToContextWindow(messages, systemPrompt, maxInputTokens);
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: chatTools,
    });

    // Collect the full response
    let assistantText = "";
    const earlyReportedToolIds = new Set<string>();

    stream.on("text", (text) => {
      assistantText += text;
      callbacks.onToken(text);
    });

    stream.on("contentBlock", (block) => {
      if (block.type === "tool_use") {
        earlyReportedToolIds.add(block.id);
        callbacks.onToolStart(
          block.id,
          block.name,
          JSON.stringify(block.input),
        );
      }
    });

    const response = await stream.finalMessage();
    const durationMs = Date.now() - startTime;
    const tokenCount =
      response.usage.input_tokens + response.usage.output_tokens;

    // Log assistant text
    if (assistantText) {
      await logInteraction(conn, threadId, {
        role: "assistant",
        kind: "message",
        content: assistantText,
        durationMs,
        tokenCount,
      });
    }

    // Check for tool calls
    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls — turn is complete
      messages.push({ role: "assistant", content: response.content });
      return;
    }

    // Add assistant response to conversation
    messages.push({ role: "assistant", content: response.content });

    // Log all tool_use entries and notify UI
    for (const toolUse of toolUseBlocks) {
      const toolInput = JSON.stringify(toolUse.input);
      if (!earlyReportedToolIds.has(toolUse.id)) {
        callbacks.onToolStart(toolUse.id, toolUse.name, toolInput);
      }

      await logInteraction(conn, threadId, {
        role: "assistant",
        kind: "tool_use",
        content: `Calling ${toolUse.name}`,
        toolName: toolUse.name,
        toolInput,
      });
    }

    // Execute all tools in parallel
    const execResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const start = Date.now();
        const result = await executeChatToolCall(toolUse, toolCtx);
        const durationMs = Date.now() - start;
        const stored = maybeStoreResult(toolUse.name, result.output);
        const meta: ToolEndMeta | undefined = stored.stored
          ? { largeResult: stored.stored }
          : undefined;
        callbacks.onToolEnd(
          toolUse.id,
          toolUse.name,
          result.output,
          result.isError,
          meta,
        );
        return { toolUse, result, durationMs, stored };
      }),
    );

    // Log results and collect tool_result messages
    const toolResults: ToolResultBlockParam[] = [];
    for (const { toolUse, result, durationMs, stored } of execResults) {
      await logInteraction(conn, threadId, {
        role: "tool",
        kind: "tool_result",
        content: result.output,
        toolName: toolUse.name,
        durationMs,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: stored.text,
        is_error: result.isError || undefined,
      });
    }

    messages.push({ role: "user", content: toolResults });
    // Loop to get the model's next response after tool results
  }
}

async function executeChatToolCall(
  toolUse: ToolUseBlock,
  ctx: ToolContext,
): Promise<{ output: string; isError: boolean }> {
  const tool = getTool(toolUse.name);
  if (!tool) return { output: `Unknown tool: ${toolUse.name}`, isError: true };
  if (!CHAT_TOOL_NAMES.has(tool.name))
    return {
      output: `Tool not available in chat mode: ${tool.name}`,
      isError: true,
    };

  const parsed = tool.inputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      output: `Invalid input: ${JSON.stringify(parsed.error)}`,
      isError: true,
    };
  }

  try {
    const result = await tool.execute(parsed.data, ctx);
    const isError =
      typeof result === "object" && result !== null && "is_error" in result
        ? (result as { is_error: boolean }).is_error
        : false;
    const output = typeof result === "string" ? result : JSON.stringify(result);
    return { output, isError };
  } catch (err) {
    return { output: `Tool error: ${err}`, isError: true };
  }
}
