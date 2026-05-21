import { isAbortError } from "@ai-sdk/provider-utils";
import type { McpxClient } from "@evantahler/mcpx";
import type { LanguageModel, ModelMessage, ToolCallPart } from "ai";
import { streamText } from "ai";
import type { BotholomewConfig } from "../config/schemas.ts";
import {
  type AbortHandle,
  createAbortHandle,
  extractCacheTokens,
  getLanguageModel,
  toAiSdkTools,
  withAnthropicCacheBreakpoints,
} from "../llm/index.ts";
import {
  openMembot,
  resolveMembotDir,
  sharedWithMem,
  type WithMem,
} from "../mem/client.ts";
import { logInteraction } from "../threads/store.ts";
import { registerAllTools } from "../tools/registry.ts";
import { getAllTools, getTool, type ToolContext } from "../tools/tool.ts";
import { fitToContextWindow, getMaxInputTokens } from "../worker/context.ts";
import { maybeStoreResult } from "../worker/large-results.ts";
import {
  buildMetaHeader,
  extractKeywords,
  loadPersistentContext,
  MEMBOT_PROMPT_SECTION,
  STYLE_RULES,
} from "../worker/prompt.ts";
import type { ChatSession } from "./session.ts";
import {
  type ContextUsage,
  estimateTokens,
  partitionMessages,
} from "./usage.ts";

registerAllTools();

/** Tools available in chat mode — no worker terminal tools (complete/fail/wait), and the destructive `membot_prune` is omitted (chat shouldn't permanently GC history). */
const CHAT_TOOL_NAMES = new Set([
  "create_task",
  "list_tasks",
  "view_task",
  "update_task",
  "delete_task",
  "membot_add",
  "membot_list",
  "membot_tree",
  "membot_read",
  "membot_write",
  "membot_edit",
  "membot_search",
  "membot_info",
  "membot_stats",
  "membot_versions",
  "membot_diff",
  "membot_refresh",
  "membot_exists",
  "membot_count_lines",
  "membot_copy",
  "membot_pipe",
  "list_threads",
  "view_thread",
  "search_threads",
  "create_schedule",
  "schedule_edit",
  "list_schedules",
  "prompt_read",
  "prompt_edit",
  "task_edit",
  "capabilities_refresh",
  "mcp_list_tools",
  "mcp_search",
  "mcp_info",
  "mcp_exec",
  "spawn_worker",
  "skill_list",
  "skill_read",
  "skill_write",
  "skill_edit",
  "skill_search",
  "skill_delete",
  "sleep",
]);

export function getChatTools() {
  return toAiSdkTools(getAllTools().filter((t) => CHAT_TOOL_NAMES.has(t.name)));
}

export async function buildChatSystemPrompt(
  projectDir: string,
  options?: {
    keywordSource?: string;
    config?: BotholomewConfig;
    hasMcpTools?: boolean;
  },
): Promise<string> {
  let prompt = buildMetaHeader(projectDir);

  const keywordSource = options?.keywordSource?.trim();
  const taskKeywords = keywordSource ? extractKeywords(keywordSource) : null;

  prompt += await loadPersistentContext(projectDir, taskKeywords);

  prompt += `## Instructions
You are Botholomew, an AI agent personified by a wise owl. This is your interactive chat interface. Help the user manage tasks, review results from background worker activity, search the knowledge store, and answer questions.
You do NOT execute long-running work directly — enqueue tasks for a background worker instead using create_task, and spawn a worker via spawn_worker when the user wants the task run now.
Use the available tools to look up tasks, threads, schedules, and the knowledge store when the user asks about them. The agent's knowledge lives in the membot store, keyed by \`logical_path\` (e.g. \`notes/foo.md\`). Use \`membot_tree\` to see what's there, \`membot_search\` (hybrid semantic + BM25) to find content, then \`membot_read\` / \`membot_info\` to drill in. Every write creates a new version — use \`membot_versions\` / \`membot_diff\` to inspect history.
Past conversations live in CSV files under \`threads/\`; use \`list_threads\`, \`search_threads\`, and \`view_thread\` to find and page through them.
When multiple tool calls are independent of each other (i.e., one does not depend on the result of another), call them all in a single response. They will be executed in parallel, which is faster than calling them one at a time.
You can manage the agent's prompt files (always-on or keyword-loaded notes the agent sees in every turn) under \`prompts/\` via \`prompt_list\`, \`prompt_read\`, \`prompt_create\`, \`prompt_edit\` (git-style line-range patches), and \`prompt_delete\`. Files marked \`agent-modification: false\` are read-only — \`prompt_edit\` and \`prompt_delete\` will refuse them.
You can author and refine slash-command skills (reusable prompt templates stored in \`skills/\`) via \`skill_list\`, \`skill_search\`, \`skill_read\`, \`skill_write\`, \`skill_edit\`, and \`skill_delete\`. New or edited skills are usable as \`/<name>\` on the user's next message.
Format your responses using Markdown. Use headings, bold, italic, lists, and code blocks to make your responses clear and well-structured.
`;

  prompt += `\n${MEMBOT_PROMPT_SECTION}`;

  if (options?.hasMcpTools) {
    prompt += `
## External Tools (MCP)

### Local knowledge store first

**Before any MCP read, search the membot knowledge store.** Prior ingests (Gmail dumps, GitHub fetches, URL captures, prior agent outputs) are usually already there — refetching is slower, costs tokens, and risks rate limits.

Workflow for any "look up / find / read" intent:

1. \`membot_search\` (hybrid semantic + BM25) over the store, then \`membot_read\` / \`membot_tree\` to drill in.
2. If freshness matters, call \`membot_info\` and check the source mtime / refresh status. To re-pull stale content, call \`membot_refresh\` for URL-backed entries, or \`membot_pipe\` an \`mcp_exec\` call to capture a fresh snapshot.
3. Only call \`mcp_exec\` for reads when the data is genuinely missing locally **or** must be real-time (e.g., "what's on my calendar right now").

Writes to external systems always go through MCP — sending an email, creating an issue, posting to Slack. Don't search membot first for those.

Examples:
- "What does doc X say?" → \`membot_search\` first.
- "Any new emails from Y?" → \`membot_search\` for the sender's name before hitting Gmail MCP.
- "Send an email to Y" → MCP write directly; no membot lookup.

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
  onToolNotify?: (toolUseId: string, message: string) => void;
  takeInjections?: () => string[];
  onUsage?: (info: ContextUsage) => void;
}

function findLastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        const p = part as { type?: string; text?: unknown };
        if (p.type === "text" && typeof p.text === "string") return p.text;
      }
    }
  }
  return "";
}

interface CollectedToolCall {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Run a single chat turn: stream the assistant response, execute any tool calls,
 * and loop until the model produces no more tool calls.
 * Mutates `messages` in-place by appending assistant/tool messages.
 */
export async function runChatTurn(input: {
  messages: ModelMessage[];
  projectDir: string;
  config: BotholomewConfig;
  threadId: string;
  mcpxClient: McpxClient | null;
  callbacks: ChatTurnCallbacks;
  session?: ChatSession;
  /** Test seam: inject a pre-built language model. */
  _testModel?: LanguageModel;
  _testMaxInputTokens?: number;
  _testWithMem?: WithMem;
}): Promise<void> {
  if (input._testWithMem) {
    await runChatTurnBody({ ...input, withMem: input._testWithMem });
    return;
  }
  const mem = openMembot(resolveMembotDir(input.projectDir, input.config));
  await mem.connect();
  try {
    await runChatTurnBody({ ...input, withMem: sharedWithMem(mem) });
  } finally {
    await mem.close();
  }
}

async function runChatTurnBody(input: {
  messages: ModelMessage[];
  projectDir: string;
  config: BotholomewConfig;
  withMem: WithMem;
  threadId: string;
  mcpxClient: McpxClient | null;
  callbacks: ChatTurnCallbacks;
  session?: ChatSession;
  _testModel?: LanguageModel;
  _testMaxInputTokens?: number;
}): Promise<void> {
  const {
    messages,
    projectDir,
    config,
    withMem,
    threadId,
    mcpxClient,
    callbacks,
    session,
  } = input;

  const model = input._testModel ?? getLanguageModel(config.llm);

  const chatTools = getChatTools();
  const maxInputTokens =
    input._testMaxInputTokens ?? (await getMaxInputTokens(config.llm));
  const maxTurns = config.max_turns;

  for (let turn = 0; !maxTurns || turn < maxTurns; turn++) {
    if (session?.aborted) return;

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

    const keywordSource = findLastUserText(messages);
    const systemPrompt = await buildChatSystemPrompt(projectDir, {
      keywordSource,
      config,
      hasMcpTools: mcpxClient != null,
    });
    const persistentContext = await loadPersistentContext(
      projectDir,
      keywordSource ? extractKeywords(keywordSource) : null,
    );

    fitToContextWindow(messages, systemPrompt, maxInputTokens);

    const wrapped = withAnthropicCacheBreakpoints({
      provider: config.llm.provider,
      system: systemPrompt,
      messages,
      tools: chatTools,
    });

    const abortHandle: AbortHandle = createAbortHandle();
    if (session) session.activeAbort = abortHandle;

    const result = streamText({
      model,
      system: wrapped.system,
      messages: wrapped.messages,
      tools: wrapped.tools,
      maxOutputTokens: 4096,
      abortSignal: abortHandle.signal,
    });

    let assistantText = "";
    const collectedToolCalls: CollectedToolCall[] = [];
    const earlyReportedToolIds = new Set<string>();

    let streamError: unknown = null;
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            assistantText += part.text;
            callbacks.onToken(part.text);
            break;
          case "tool-input-start":
            earlyReportedToolIds.add(part.id);
            callbacks.onToolPreparing?.(part.id, part.toolName);
            break;
          case "tool-call":
            collectedToolCalls.push({
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            });
            break;
          case "error":
            streamError = part.error;
            break;
        }
      }
    } catch (err) {
      streamError = err;
    } finally {
      if (session) session.activeAbort = null;
    }

    if (streamError) {
      if (abortHandle.signal.aborted || isAbortError(streamError)) {
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
      }
      throw streamError;
    }

    const durationMs = Date.now() - startTime;
    const usage = await result.usage;
    const providerMeta = await result.providerMetadata;
    const cacheTokens = extractCacheTokens(usage, providerMeta);
    const tokenCount = cacheTokens.input + cacheTokens.output;
    const promptTokens =
      cacheTokens.input + cacheTokens.cacheRead + cacheTokens.cacheCreation;

    if (callbacks.onUsage) {
      const { textChars, toolIoChars } = partitionMessages(messages);
      const promptsChars = persistentContext.length;
      const instructionsChars = Math.max(0, systemPrompt.length - promptsChars);
      const toolsChars = JSON.stringify(chatTools).length;
      callbacks.onUsage({
        used: promptTokens,
        max: maxInputTokens,
        breakdown: {
          prompts: estimateTokens(promptsChars),
          instructions: estimateTokens(instructionsChars),
          tools: estimateTokens(toolsChars),
          messages: estimateTokens(textChars),
          toolIo: estimateTokens(toolIoChars),
        },
      });
    }

    if (assistantText) {
      await logInteraction(projectDir, threadId, {
        role: "assistant",
        kind: "message",
        content: assistantText,
        durationMs,
        tokenCount,
      });
    }

    if (collectedToolCalls.length === 0) {
      if (assistantText) {
        messages.push({ role: "assistant", content: assistantText });
      }
      return;
    }

    // Build assistant turn (text + tool calls) for the conversation history.
    const assistantContent: Array<
      ToolCallPart | { type: "text"; text: string }
    > = [];
    if (assistantText) {
      assistantContent.push({ type: "text", text: assistantText });
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
      if (!earlyReportedToolIds.has(tc.id)) {
        callbacks.onToolStart(tc.id, tc.name, toolInput);
      } else {
        // Promote: emit onToolStart now that we have the final input.
        callbacks.onToolStart(tc.id, tc.name, toolInput);
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
        const exec = await executeChatToolCall(tc, {
          withMem,
          projectDir,
          config,
          mcpxClient,
          shouldAbort: session ? () => session.aborted : undefined,
          notify: callbacks.onToolNotify
            ? (msg) => callbacks.onToolNotify?.(tc.id, msg)
            : undefined,
        });
        const d = Date.now() - start;
        const stored = maybeStoreResult(tc.name, exec.output);
        const meta: ToolEndMeta | undefined = stored.stored
          ? { largeResult: stored.stored }
          : undefined;
        callbacks.onToolEnd(tc.id, tc.name, exec.output, exec.isError, meta);
        return { tc, exec, durationMs: d, stored };
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

    for (const { tc, exec, durationMs, stored } of execResults) {
      await logInteraction(projectDir, threadId, {
        role: "tool",
        kind: "tool_result",
        content: exec.output,
        toolName: tc.name,
        durationMs,
      });

      toolResultContent.push({
        type: "tool-result",
        toolCallId: tc.id,
        toolName: tc.name,
        output: exec.isError
          ? { type: "error-text", value: stored.text }
          : { type: "text", value: stored.text },
      });
    }

    messages.push({ role: "tool", content: toolResultContent });
    if (session?.aborted) return;
  }
}

interface ChatToolCallCtx {
  withMem: WithMem;
  projectDir: string;
  config: BotholomewConfig;
  mcpxClient: McpxClient | null;
  shouldAbort?: () => boolean;
  notify?: (message: string) => void;
}

async function executeChatToolCall(
  toolCall: CollectedToolCall,
  baseCtx: ChatToolCallCtx,
): Promise<{ output: string; isError: boolean }> {
  const tool = getTool(toolCall.name);
  if (!tool) return { output: `Unknown tool: ${toolCall.name}`, isError: true };
  if (!CHAT_TOOL_NAMES.has(tool.name))
    return {
      output: `Tool not available in chat mode: ${tool.name}`,
      isError: true,
    };

  const parsed = tool.inputSchema.safeParse(toolCall.input);
  if (!parsed.success) {
    return {
      output: `Invalid input: ${JSON.stringify(parsed.error)}`,
      isError: true,
    };
  }

  try {
    const ctx: ToolContext = baseCtx;
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
