import type Anthropic from "@anthropic-ai/sdk";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import { withDb } from "../db/connection.ts";
import { logInteraction } from "../threads/store.ts";
import { registerAllTools } from "../tools/registry.ts";
import {
  getAllTools,
  getTool,
  type ToolContext,
  toAnthropicTool,
} from "../tools/tool.ts";
import { fitToContextWindow, getMaxInputTokens } from "../worker/context.ts";
import { maybeStoreResult } from "../worker/large-results.ts";
import { createLlmClient } from "../worker/llm-client.ts";
import {
  buildMetaHeader,
  extractKeywords,
  loadPersistentContext,
  STYLE_RULES,
} from "../worker/prompt.ts";
import type { ChatSession } from "./session.ts";

registerAllTools();

/** Tools available in chat mode — no worker terminal tools (complete/fail/wait), no bulk-destructive file tools (delete, copy/move, dir ops) */
const CHAT_TOOL_NAMES = new Set([
  "create_task",
  "list_tasks",
  "view_task",
  "context_info",
  "context_tree",
  "context_read",
  "context_write",
  "context_edit",
  "search",
  "list_threads",
  "view_thread",
  "search_threads",
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

  prompt += `## Instructions
You are Botholomew, an AI agent personified by a wise owl. This is your interactive chat interface. Help the user manage tasks, review results from background worker activity, search context, and answer questions.
You do NOT execute long-running work directly — enqueue tasks for a background worker instead using create_task, and spawn a worker via spawn_worker when the user wants the task run now.
Use the available tools to look up tasks, threads, schedules, and context when the user asks about them. Files the agent can read and write live under \`context/\` as project-relative paths (e.g. \`notes/foo.md\`). Use \`context_tree\` to see what's there, \`search\` (hybrid regexp + semantic) to find content, then \`context_read\` / \`context_info\` to drill in.
Past conversations live in CSV files under \`threads/\`; use \`list_threads\`, \`search_threads\`, and \`view_thread\` to find and page through them.
When multiple tool calls are independent of each other (i.e., one does not depend on the result of another), call them all in a single response. They will be executed in parallel, which is faster than calling them one at a time.
You can update the agent's beliefs and goals files when the user asks you to.
You can author and refine slash-command skills (reusable prompt templates stored in \`skills/\`) via \`skill_list\`, \`skill_search\`, \`skill_read\`, \`skill_write\`, \`skill_edit\`, and \`skill_delete\`. New or edited skills are usable as \`/<name>\` on the user's next message.
Format your responses using Markdown. Use headings, bold, italic, lists, and code blocks to make your responses clear and well-structured.
`;

  if (options?.hasMcpTools) {
    prompt += `
## External Tools (MCP)

### Local context first

**Before any MCP read, search local context.** Files in \`context/\` (Gmail dumps, GitHub fetches, URL ingests, prior agent outputs) are usually already there — refetching is slower, costs tokens, and risks rate limits.

Workflow for any "look up / find / read" intent:

1. \`search\` (hybrid regexp + semantic) over \`context/\`, then \`context_read\` / \`context_tree\` to drill in.
2. If freshness matters, call \`context_info\` and check the file's mtime. To re-pull stale content, write fresh into \`context/\` (\`pipe_to_context\` from an \`mcp_exec\` call is the typical path) rather than going to MCP for the whole document on every question.
3. Only call \`mcp_exec\` for reads when the data is genuinely missing locally **or** must be real-time (e.g., "what's on my calendar right now").

Writes always go through MCP — sending an email, creating an issue, posting to Slack. Don't search context first for those.

Examples:
- "What does doc X say?" → \`search\` first.
- "Any new emails from Y?" → \`search\` for the sender under \`context/gmail/\` (or wherever you've been ingesting mail) before hitting Gmail MCP.
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
  /** Called between LLM turns. The TUI returns any queued user messages so
   *  the agent can inject them into the running turn instead of waiting for
   *  the entire tool loop to finish. Each returned message is logged + pushed
   *  to `messages` before the next `messages.stream(...)` call. */
  takeInjections?: () => string[];
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
  /** When supplied, the loop honors `session.aborted` (set by Esc in the TUI)
   *  and writes the live `MessageStream` to `session.activeStream` so it can
   *  be aborted from outside. */
  session?: ChatSession;
  /** Test seam: inject a pre-built client and skip the model-info fetch.
   *  Production callers should leave both unset. */
  _testClient?: Anthropic;
  _testMaxInputTokens?: number;
}): Promise<void> {
  const {
    messages,
    projectDir,
    config,
    dbPath,
    threadId,
    mcpxClient,
    callbacks,
    session,
  } = input;

  const client = input._testClient ?? createLlmClient(config);

  const chatTools = getChatTools();
  const maxInputTokens =
    input._testMaxInputTokens ??
    (await getMaxInputTokens(config.anthropic_api_key, config.model));
  const maxTurns = config.max_turns;

  for (let turn = 0; !maxTurns || turn < maxTurns; turn++) {
    if (session?.aborted) return;

    // Steering: drain any user messages the TUI queued during the previous
    // iteration so they land in the next LLM call rather than waiting for
    // the whole tool loop to finish.
    const injections = callbacks.takeInjections?.() ?? [];
    for (const text of injections) {
      await logInteraction(projectDir, threadId, {
        role: "user",
        kind: "message",
        content: text,
      });
      messages.push({ role: "user", content: text });
    }

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
    if (session) session.activeStream = stream;

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

    let response: Message;
    try {
      response = await stream.finalMessage();
    } catch (err) {
      if (!(err instanceof APIUserAbortError)) throw err;
      // Esc was pressed mid-stream. Persist whatever text the user already saw
      // (the `'text'` event has fired for everything reaching us, so
      // `assistantText` is the right partial value). Deliberately drop any
      // partial tool_use blocks — they would be unmatched on the next turn.
      if (assistantText) {
        await logInteraction(projectDir, threadId, {
          role: "assistant",
          kind: "message",
          content: assistantText,
          durationMs: Date.now() - startTime,
          tokenCount: 0,
        });
        messages.push({ role: "assistant", content: assistantText });
      }
      return;
    } finally {
      if (session) session.activeStream = null;
    }
    const durationMs = Date.now() - startTime;
    const tokenCount =
      response.usage.input_tokens + response.usage.output_tokens;

    // Log assistant text
    if (assistantText) {
      await logInteraction(projectDir, threadId, {
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

      await logInteraction(projectDir, threadId, {
        role: "assistant",
        kind: "tool_use",
        content: `Calling ${toolUse.name}`,
        toolName: toolUse.name,
        toolInput,
      });
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
      await logInteraction(projectDir, threadId, {
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
    if (session?.aborted) return;
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
