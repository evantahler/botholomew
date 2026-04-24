import Anthropic from "@anthropic-ai/sdk";
import type {
  Tool as AnthropicTool,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import { mcpExecTool } from "../tools/mcp/exec.ts";
import { mcpInfoTool } from "../tools/mcp/info.ts";
import { mcpListToolsTool } from "../tools/mcp/list-tools.ts";
import { mcpSearchTool } from "../tools/mcp/search.ts";
import type { ToolContext } from "../tools/tool.ts";
import { type AnyToolDefinition, toAnthropicTool } from "../tools/tool.ts";
import { logger } from "../utils/logger.ts";
import { detectDriveFromUrl } from "./drives.ts";
import { stripHtmlTags } from "./url-utils.ts";

const MAX_CONTENT_BYTES = 500_000;
const MAX_TURNS = 10;
const MAX_RESPONSE_TOKENS = 4_096;
const PREVIEW_CHARS = 2_000;
const HTTP_TIMEOUT_MS = 30_000;

export interface FetchedContent {
  title: string;
  content: string;
  mimeType: string;
  sourceUrl: string;
  drive: string;
  path: string;
}

export class FetchFailureError extends Error {
  readonly userMessage: string;
  constructor(message: string) {
    super(message);
    this.name = "FetchFailureError";
    this.userMessage = message;
  }
}

const FETCHER_SYSTEM_PROMPT = `You are a content fetcher. Your job is to find the right MCP tool to retrieve the content at the given URL, run it, and tell the harness which result to save.

**Important: the harness captures the full result of every mcp_exec call automatically.** You only see a short preview of each result so you can verify it looks reasonable. You do NOT need to read or copy the full content — you just identify which exec call to save.

Strongly prefer markdown output. Most MCP tools support a markdown/format parameter — use it when available.

Workflow:
1. Use mcp_search or mcp_list_tools to find the best tool for this URL (e.g., Google Docs tools for docs.google.com, Firecrawl for generic web pages, GitHub tools for github.com).
2. Use mcp_info to inspect the tool's input schema.
3. Call mcp_exec with the right arguments — request markdown format when supported.
4. Look at the preview returned by mcp_exec. If it looks like the right content, call accept_content with the exec_call_id (the tool_use_id of the mcp_exec call) and a sensible title.

Terminal tools:
- accept_content(exec_call_id, title, mime_type?) — save the full content captured from a previous mcp_exec call. The harness has the full content; you just supply the id, title, and optional mime_type (defaults to text/markdown).
- request_http_fallback() — fall back to a basic HTTP fetch. Use only when no MCP tool can handle the URL after a genuine attempt. Tools like Firecrawl can handle most URLs, so don't give up on the first try.
- report_failure(message) — surface an actionable message to the user (e.g., "this Google Doc is private — share it with your service account", "Firecrawl is not authenticated"). Use only when there is a specific next step the user must take.`;

const acceptContentTool: AnthropicTool = {
  name: "accept_content",
  description:
    "Save the full content captured by the harness from a previous mcp_exec call. You only need to supply the exec_call_id (the tool_use_id of that mcp_exec call) and a title — the harness already has the full content. Do NOT paste content here.",
  input_schema: {
    type: "object" as const,
    properties: {
      exec_call_id: {
        type: "string",
        description:
          "The tool_use_id of the mcp_exec call whose result should be saved (the harness lists captured ids in mcp_exec previews).",
      },
      title: {
        type: "string",
        description:
          "A human-readable title for the content (e.g., the document title, or derived from the URL).",
      },
      mime_type: {
        type: "string",
        description: "MIME type of the content (defaults to text/markdown).",
      },
    },
    required: ["exec_call_id", "title"],
  },
};

interface AcceptContentInput {
  exec_call_id: string;
  title: string;
  mime_type?: string;
}

const requestHttpFallbackTool: AnthropicTool = {
  name: "request_http_fallback",
  description:
    "Fall back to a basic HTTP fetch. Use only when no MCP tool can handle the URL after a genuine attempt.",
  input_schema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

const reportFailureTool: AnthropicTool = {
  name: "report_failure",
  description:
    "Report a fetch failure with an actionable message for the user (e.g., 'this Google Doc is private — share it with your service account'). Use only when there is a clear next step the user must take.",
  input_schema: {
    type: "object" as const,
    properties: {
      message: {
        type: "string",
        description:
          "A clear, actionable, user-facing message explaining what the user needs to do to make this URL fetchable.",
      },
    },
    required: ["message"],
  },
};

interface ReportFailureInput {
  message: string;
}

const mcpTools: AnyToolDefinition[] = [
  mcpListToolsTool as unknown as AnyToolDefinition,
  mcpSearchTool as unknown as AnyToolDefinition,
  mcpInfoTool as unknown as AnyToolDefinition,
  mcpExecTool as unknown as AnyToolDefinition,
];

export async function fetchUrl(
  url: string,
  config: Required<BotholomewConfig>,
  mcpxClient: McpxClient | null,
  promptAddition?: string,
): Promise<FetchedContent> {
  if (!config.anthropic_api_key) {
    throw new Error(
      "Anthropic API key is required for URL fetching. Set ANTHROPIC_API_KEY or configure it in .botholomew/config.json",
    );
  }

  if (!mcpxClient) {
    logger.dim("  no MCPX client — using HTTP fallback");
    return httpFallback(url);
  }

  const result = await runFetcherLoop(url, config, mcpxClient, promptAddition);
  if (result) return result;

  logger.dim("  agent signaled fallback — using HTTP");
  return httpFallback(url);
}

async function runFetcherLoop(
  url: string,
  config: Required<BotholomewConfig>,
  mcpxClient: McpxClient,
  promptAddition?: string,
): Promise<FetchedContent | null> {
  const client = new Anthropic({ apiKey: config.anthropic_api_key });

  const toolCtx: ToolContext = {
    conn: null as unknown as DbConnection,
    dbPath: "",
    projectDir: "",
    config,
    mcpxClient,
  };

  const tools: AnthropicTool[] = [
    ...mcpTools.map(toAnthropicTool),
    acceptContentTool,
    requestHttpFallbackTool,
    reportFailureTool,
  ];

  // Cache of full mcp_exec results keyed by tool_use_id.
  // The LLM only sees a truncated preview; on accept_content it references
  // the id and the harness saves the captured content. `server` is retained so
  // we can attribute the save to a specific MCP service when routing to a drive.
  const execResults = new Map<
    string,
    { server: string; tool: string; content: string; mimeType: string }
  >();

  const userPrompt = promptAddition
    ? `Fetch the content at: ${url}\n\nAdditional guidance:\n${promptAddition}`
    : `Fetch the content at: ${url}`;
  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: MAX_RESPONSE_TOKENS,
      system: FETCHER_SYSTEM_PROMPT,
      messages,
      tools,
    });

    // Log assistant text reasoning
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        logger.dim(`  turn ${turn + 1}: ${block.text.trim()}`);
      }
    }

    if (response.stop_reason === "max_tokens") {
      throw new FetchFailureError(
        `The fetched document is too large to return in a single LLM response (hit max_tokens=${MAX_RESPONSE_TOKENS}). Try fetching a smaller section, a specific page, or a tool that supports pagination.`,
      );
    }

    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      logger.dim(`  turn ${turn + 1}: no tool calls — signaling fallback`);
      return null;
    }

    messages.push({ role: "assistant", content: response.content });

    // Check for report_failure first (terminal — surfaces actionable user message)
    const failureCall = toolUseBlocks.find((b) => b.name === "report_failure");
    if (failureCall) {
      const input = failureCall.input as Partial<ReportFailureInput>;
      const message =
        typeof input.message === "string" && input.message.trim()
          ? input.message
          : "Fetch failed but the agent did not provide a message.";
      logger.dim(`  turn ${turn + 1}: report_failure: ${message}`);
      throw new FetchFailureError(message);
    }

    // Check for request_http_fallback (terminal)
    const fallbackCall = toolUseBlocks.find(
      (b) => b.name === "request_http_fallback",
    );
    if (fallbackCall) {
      logger.dim(`  turn ${turn + 1}: agent requested HTTP fallback`);
      return null;
    }

    // Check for accept_content (terminal — looks up captured exec result)
    const acceptCall = toolUseBlocks.find((b) => b.name === "accept_content");
    if (acceptCall) {
      const input = acceptCall.input as Partial<AcceptContentInput>;
      if (
        typeof input.exec_call_id !== "string" ||
        typeof input.title !== "string"
      ) {
        logger.dim(
          `  turn ${turn + 1}: accept_content missing required fields — asking agent to retry`,
        );
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: acceptCall.id,
              content:
                "Invalid accept_content call: both 'exec_call_id' and 'title' are required strings.",
              is_error: true,
            },
          ],
        });
        continue;
      }
      const cached = execResults.get(input.exec_call_id);
      if (!cached) {
        const validIds = [...execResults.keys()];
        logger.dim(
          `  turn ${turn + 1}: accept_content: unknown exec_call_id "${input.exec_call_id}"`,
        );
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: acceptCall.id,
              content: `No mcp_exec call with id "${input.exec_call_id}" was captured. Captured ids: ${validIds.length ? validIds.join(", ") : "(none yet — run mcp_exec first)"}.`,
              is_error: true,
            },
          ],
        });
        continue;
      }
      const mimeType = input.mime_type || cached.mimeType;
      logger.dim(
        `  turn ${turn + 1}: accept_content: "${input.title}" (${cached.content.length} chars, ${mimeType}, from ${cached.server}/${cached.tool})`,
      );
      const { drive, path } = detectDriveFromUrl(url, cached.server);
      return {
        title: input.title,
        content: cached.content.slice(0, MAX_CONTENT_BYTES),
        mimeType,
        sourceUrl: url,
        drive,
        path,
      };
    }

    // Execute non-terminal MCP tools in parallel
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        // Log which tool the agent selected (and the underlying MCP server/tool for mcp_exec)
        const toolInput = toolUse.input as Record<string, unknown>;
        if (toolUse.name === "mcp_exec") {
          logger.dim(
            `  turn ${turn + 1}: mcp_exec → ${toolInput.server}/${toolInput.tool}`,
          );
        } else {
          const args = JSON.stringify(toolInput).slice(0, 80);
          logger.dim(`  turn ${turn + 1}: ${toolUse.name}(${args})`);
        }

        const toolDef = mcpTools.find((t) => t.name === toolUse.name);
        if (!toolDef) {
          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: `Unknown tool: ${toolUse.name}`,
            is_error: true,
          };
        }

        try {
          const parsed = toolDef.inputSchema.safeParse(toolUse.input);
          if (!parsed.success) {
            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: `Invalid input: ${parsed.error.message}`,
              is_error: true,
            };
          }
          const result = await toolDef.execute(parsed.data, toolCtx);
          if (result.is_error) {
            logger.dim(
              `         → error: ${JSON.stringify(result).slice(0, 160)}`,
            );
            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
              is_error: true,
            };
          }

          // For successful mcp_exec calls, capture the full content in the
          // harness and send only a preview to the LLM. The LLM accepts the
          // result by referring to its tool_use_id.
          if (toolUse.name === "mcp_exec") {
            const execResult = result as {
              result: string;
              is_error: boolean;
            };
            const content = execResult.result;
            execResults.set(toolUse.id, {
              server: String(toolInput.server),
              tool: String(toolInput.tool),
              content,
              mimeType: "text/markdown",
            });
            const preview =
              content.length > PREVIEW_CHARS
                ? `${content.slice(0, PREVIEW_CHARS)}\n\n[... ${content.length - PREVIEW_CHARS} more chars truncated. Full content (${content.length} chars total) is captured by the harness with exec_call_id="${toolUse.id}". Call accept_content with this id to save it.]`
                : `${content}\n\n[Full content (${content.length} chars) captured by the harness with exec_call_id="${toolUse.id}". Call accept_content with this id to save it.]`;
            logger.dim(
              `         → captured ${content.length} chars (id=${toolUse.id})`,
            );
            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: preview,
            };
          }

          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          };
        } catch (err) {
          logger.dim(`         → exception: ${err}`);
          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: `Error: ${err}`,
            is_error: true,
          };
        }
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  logger.dim(`  max turns (${MAX_TURNS}) exceeded — signaling fallback`);
  return null;
}

export async function httpFallback(url: string): Promise<FetchedContent> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Botholomew/1.0" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  let text = await response.text();

  let title = url;
  if (isHtml) {
    const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
      title = titleMatch[1].trim();
    }
    text = stripHtmlTags(text);
  }

  if (text.length > MAX_CONTENT_BYTES) {
    text = text.slice(0, MAX_CONTENT_BYTES);
  }

  const mimeType = isHtml
    ? "text/markdown"
    : contentType.split(";")[0] || "text/plain";

  const { drive, path } = detectDriveFromUrl(url);
  return {
    title,
    content: text,
    mimeType,
    sourceUrl: url,
    drive,
    path,
  };
}
