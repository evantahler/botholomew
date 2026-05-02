import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import { embedSingle } from "../context/embedder.ts";
import { withDb } from "../db/connection.ts";
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
import { fitToContextWindow, getMaxInputTokens } from "../worker/context.ts";
import { maybeStoreResult } from "../worker/large-results.ts";
import { createLlmClient } from "../worker/llm-client.ts";
import {
  buildMetaHeader,
  extractKeywords,
  loadPersistentContext,
  STYLE_RULES,
} from "../worker/prompt.ts";

registerAllTools();

/** Tools available in chat mode — no worker terminal tools (complete/fail/wait), no bulk-destructive file tools (delete, copy/move, dir ops) */
const CHAT_TOOL_NAMES = new Set([
  "create_task",
  "list_tasks",
  "view_task",
  "context_search",
  "context_info",
  "context_refresh",
  "context_tree",
  "context_list_drives",
  "context_read",
  "context_write",
  "context_edit",
  "search_grep",
  "search_semantic",
  "list_threads",
  "view_thread",
  "create_schedule",
  "list_schedules",
  "update_beliefs",
  "update_goals",
  "capabilities_refresh",
  "mcp_list_tools",
  "mcp_search",
  "mcp_info",
  "mcp_exec",
  "read_large_result",
  "pipe_to_context",
  "spawn_worker",
  "skill_list",
  "skill_read",
  "skill_write",
  "skill_edit",
  "skill_search",
  "skill_delete",
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
    dbPath?: string;
    config?: Required<BotholomewConfig>;
    hasMcpTools?: boolean;
  },
): Promise<string> {
  let prompt = buildMetaHeader(projectDir);

  const keywordSource = options?.keywordSource?.trim();
  const taskKeywords = keywordSource ? extractKeywords(keywordSource) : null;

  prompt += await loadPersistentContext(projectDir, taskKeywords);

  const dbPath = options?.dbPath;
  const config = options?.config;
  if (dbPath && config && keywordSource) {
    try {
      const queryVec = await embedSingle(keywordSource, config);
      const results = await withDb(dbPath, (conn) =>
        hybridSearch(conn, keywordSource, queryVec, 5),
      );

      if (results.length > 0) {
        prompt += "## Relevant Context\n";
        for (const r of results) {
          const ref =
            r.drive && r.path ? `${r.drive}:${r.path}` : r.context_item_id;
          prompt += `### ${r.title} (${ref})\n`;
          if (r.chunk_content) {
            prompt += `${r.chunk_content.slice(0, 1000)}\n`;
          }
          prompt += "\n";
        }
      }
    } catch (err) {
      logger.debug(`Failed to load contextual embeddings: ${err}`);
    }
  }

  prompt += `## Instructions
You are Botholomew, an AI agent personified by a wise owl. This is your interactive chat interface. Help the user manage tasks, review results from background worker activity, search context, and answer questions.
You do NOT execute long-running work directly — enqueue tasks for a background worker instead using create_task, and spawn a worker via spawn_worker when the user wants the task run now.
Use the available tools to look up tasks, threads, schedules, and context when the user asks about them. Context items live under a drive (disk / url / agent / google-docs / github / …); use \`context_list_drives\` to discover which drives have content, then \`context_tree\`, \`context_info\`, \`context_search\`, or \`context_refresh\` as needed.
When multiple tool calls are independent of each other (i.e., one does not depend on the result of another), call them all in a single response. They will be executed in parallel, which is faster than calling them one at a time.
You can update the agent's beliefs and goals files when the user asks you to.
You can author and refine slash-command skills (reusable prompt templates stored in \`.botholomew/skills/\`) via \`skill_list\`, \`skill_search\`, \`skill_read\`, \`skill_write\`, \`skill_edit\`, and \`skill_delete\`. New or edited skills are usable as \`/<name>\` on the user's next message.
Format your responses using Markdown. Use headings, bold, italic, lists, and code blocks to make your responses clear and well-structured.
`;

  if (options?.hasMcpTools) {
    prompt += `
## External Tools (MCP)

### Local context first

**Before any MCP read, search local context.** Drive, Gmail, GitHub, URLs, and prior agent runs are usually already ingested — refetching is slower, costs tokens, and risks rate limits.

Workflow for any "look up / find / read" intent:

1. \`search_semantic\` (semantic) or \`context_search\` (keyword), then \`context_read\` / \`context_tree\` to drill in.
2. If freshness matters, call \`context_info\` and check \`indexed_at\`. To re-pull a single stale item, use \`context_refresh\` rather than going to MCP for the whole document.
3. Only call \`mcp_exec\` for reads when the data is genuinely missing locally **or** must be real-time (e.g., "what's on my calendar right now").

Writes always go through MCP — sending an email, creating an issue, posting to Slack. Don't search context first for those.

Examples:
- "What does doc X say?" → \`search_semantic\` first.
- "Any new emails from Y?" → check the \`gmail\` drive first; only hit Gmail MCP if the freshest indexed item is too old for the question.
- "Send an email to Y" → MCP write directly; no context lookup.

### Calling MCP tools

Before calling any MCP tool you haven't used yet this session, you MUST fetch its schema first:

1. Discover tools with \`mcp_search\` (preferred — semantic) or \`mcp_list_tools\`.
2. Call \`mcp_info\` with the exact \`server\` and \`tool\` to read the tool's input schema, required fields, and types.
3. Only then call \`mcp_exec\` with arguments that conform to that schema.

Skip step 2 only if you already called \`mcp_info\` for that exact server+tool earlier in this conversation. Do not guess arguments from the tool's description alone — descriptions omit types and required/optional markers.
`;
  }

  prompt += `\n${STYLE_RULES}`;

  return prompt;
}

export interface ToolEndMeta {
  largeResult?: { id: string; chars: number; pages: number };
}

export interface ChatTurnCallbacks {
  onToken: (text: string) => void;
  onToolPreparing?: (id: string, name: string) => void;
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
  dbPath: string;
  threadId: string;
  mcpxClient: McpxClient | null;
  callbacks: ChatTurnCallbacks;
}): Promise<void> {
  const {
    messages,
    projectDir,
    config,
    dbPath,
    threadId,
    mcpxClient,
    callbacks,
  } = input;

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
      dbPath,
      config,
      hasMcpTools: mcpxClient != null,
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

    stream.on("streamEvent", (event) => {
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        callbacks.onToolPreparing?.(
          event.content_block.id,
          event.content_block.name,
        );
      }
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
      await withDb(dbPath, (conn) =>
        logInteraction(conn, threadId, {
          role: "assistant",
          kind: "message",
          content: assistantText,
          durationMs,
          tokenCount,
        }),
      );
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

      await withDb(dbPath, (conn) =>
        logInteraction(conn, threadId, {
          role: "assistant",
          kind: "tool_use",
          content: `Calling ${toolUse.name}`,
          toolName: toolUse.name,
          toolInput,
        }),
      );
    }

    // Execute all tools in parallel. Each tool call opens its own short-lived
    // connection; parallel calls share the process-local DuckDB instance and
    // release the file lock as soon as the last one finishes.
    const execResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const start = Date.now();
        const result = await executeChatToolCall(toolUse, {
          dbPath,
          projectDir,
          config,
          mcpxClient,
        });
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
      await withDb(dbPath, (conn) =>
        logInteraction(conn, threadId, {
          role: "tool",
          kind: "tool_result",
          content: result.output,
          toolName: toolUse.name,
          durationMs,
        }),
      );

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

interface ChatToolCallCtx {
  dbPath: string;
  projectDir: string;
  config: Required<BotholomewConfig>;
  mcpxClient: McpxClient | null;
}

async function executeChatToolCall(
  toolUse: ToolUseBlock,
  baseCtx: ChatToolCallCtx,
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
    const result = await withDb(baseCtx.dbPath, (conn) => {
      const ctx: ToolContext = { ...baseCtx, conn };
      return tool.execute(parsed.data, ctx);
    });
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
