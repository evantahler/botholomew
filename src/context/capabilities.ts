import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getBotholomewDir } from "../constants.ts";
import { getAllTools, type ToolDefinition } from "../tools/tool.ts";
import {
  type ContextFileMeta,
  parseContextFile,
  serializeContextFile,
} from "../utils/frontmatter.ts";
import { logger } from "../utils/logger.ts";

export const CAPABILITIES_FILENAME = "capabilities.md";

// LLM config — summarization is one call per refresh, no streaming needed.
const SUMMARIZE_TIMEOUT_MS = 30_000;
const SUMMARIZE_MAX_TOKENS = 4096;

// biome-ignore lint/suspicious/noExplicitAny: Zod-free tool schema for Anthropic SDK
type AnyTool = ToolDefinition<any, any>;

/**
 * Groups rendered for built-in tools when we can't summarize via LLM.
 * Order here controls rendering order in the fallback.
 */
const GROUP_ORDER = [
  "task",
  "schedule",
  "context",
  "search",
  "thread",
  "mcp",
  "worker",
  "capabilities",
] as const;

const GROUP_HEADINGS: Record<string, string> = {
  task: "Task management",
  schedule: "Schedules",
  context: "Virtual filesystem & self-reflection",
  search: "Search",
  thread: "Threads",
  mcp: "MCPX meta-tools",
  worker: "Workers",
  capabilities: "Capabilities",
  other: "Other",
};

export interface CapabilitiesCounts {
  internal: number;
  mcp: number;
}

export interface GenerateResult {
  body: string;
  counts: CapabilitiesCounts;
}

/** Called at each phase transition so callers (CLI) can render progress. */
export type ProgressCallback = (phase: string) => void;

interface RawInventory {
  internal: Map<string, AnyTool[]>;
  internalTotal: number;
  mcpByServer: Map<string, Array<{ name: string; description: string }>>;
  mcpTotal: number;
  mcpError: string | null;
  mcpConfigured: boolean;
}

/** Collect the tool inventory without rendering. */
async function collectInventory(
  mcpxClient: McpxClient | null,
  onPhase?: ProgressCallback,
): Promise<RawInventory> {
  onPhase?.("Scanning internal tools");
  const allTools = getAllTools();
  const internal = new Map<string, AnyTool[]>();
  for (const tool of allTools) {
    const key = (GROUP_ORDER as readonly string[]).includes(tool.group)
      ? tool.group
      : "other";
    const list = internal.get(key) ?? [];
    list.push(tool);
    internal.set(key, list);
  }

  const mcpByServer = new Map<
    string,
    Array<{ name: string; description: string }>
  >();
  let mcpTotal = 0;
  let mcpError: string | null = null;

  if (mcpxClient) {
    onPhase?.("Querying MCPX servers");
    try {
      const mcpTools = await mcpxClient.listTools();
      mcpTotal = mcpTools.length;
      for (const entry of mcpTools) {
        const list = mcpByServer.get(entry.server) ?? [];
        list.push({
          name: entry.tool.name,
          description: (entry.tool.description ?? "").trim(),
        });
        mcpByServer.set(entry.server, list);
      }
    } catch (err) {
      mcpError = (err as Error).message;
    }
  }

  return {
    internal,
    internalTotal: allTools.length,
    mcpByServer,
    mcpTotal,
    mcpError,
    mcpConfigured: mcpxClient !== null,
  };
}

// ---------------------------------------------------------------------------
// LLM summarization
// ---------------------------------------------------------------------------

interface Theme {
  name: string;
  summary: string;
}

interface ServerThemes {
  server: string;
  themes: Theme[];
}

interface SummarizedCapabilities {
  internal_themes: Theme[];
  mcpx_servers: ServerThemes[];
}

const SUMMARIZE_TOOL_NAME = "return_capability_summary";
const SUMMARIZE_TOOL = {
  name: SUMMARIZE_TOOL_NAME,
  description:
    "Return thematic capability summaries for the agent's tool inventory.",
  input_schema: {
    type: "object" as const,
    properties: {
      internal_themes: {
        type: "array",
        description:
          "Themes covering the agent's built-in tools (task queue, virtual filesystem, search, threads, MCPX meta-tools, workers, self-reflection, etc.).",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Short theme name (2-4 words).",
            },
            summary: {
              type: "string",
              description:
                "One sentence with concrete action verbs. No tool names. No preamble.",
            },
          },
          required: ["name", "summary"],
        },
      },
      mcpx_servers: {
        type: "array",
        description:
          "MCPX tools grouped by their source server. Within each server, split into themes only when the server exposes distinct services (e.g. Gmail + Google Calendar on one server).",
        items: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "Server name exactly as given in the inventory.",
            },
            themes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Theme name (usually the service, e.g. Gmail)",
                  },
                  summary: {
                    type: "string",
                    description:
                      "One sentence with concrete action verbs. No tool names.",
                  },
                },
                required: ["name", "summary"],
              },
            },
          },
          required: ["server", "themes"],
        },
      },
    },
    required: ["internal_themes", "mcpx_servers"],
  },
};

function renderInventoryForPrompt(inv: RawInventory): string {
  const sections: string[] = [];
  sections.push("## Internal tools");
  for (const group of [...GROUP_ORDER, "other" as const]) {
    const tools = inv.internal.get(group);
    if (!tools || tools.length === 0) continue;
    sections.push(`\n### ${GROUP_HEADINGS[group] ?? group}`);
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    for (const t of sorted) {
      sections.push(`- ${t.name}: ${t.description}`);
    }
  }

  if (inv.mcpByServer.size > 0) {
    sections.push("\n## MCPX tools");
    const servers = [...inv.mcpByServer.keys()].sort();
    for (const server of servers) {
      sections.push(`\n### ${server}`);
      const tools = inv.mcpByServer.get(server) ?? [];
      const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
      for (const t of sorted) {
        sections.push(`- ${t.name}: ${t.description || "(no description)"}`);
      }
    }
  }

  return sections.join("\n");
}

const SUMMARIZE_SYSTEM = `You summarize an AI agent's tool inventory into a terse "capabilities" document. The agent loads this document into every system prompt, so it MUST be compact — 1 line per theme.

Rules:
- Do NOT list specific tool names. The agent discovers exact names via the MCPX meta-tools (mcp_search, mcp_list_tools, mcp_info) when it actually needs to invoke one.
- Group tools into natural themes.
- For MCPX tools, one theme usually = one external service (Gmail, Google Calendar, GitHub, Linear, Slack, Google Docs, Google Drive, Google Sheets, Apple Notes, etc.). Split a single server into multiple themes when it clearly exposes distinct services.
- For internal tools, use coarse buckets aligned with the provided groups (task management, virtual filesystem, search, threads, MCPX meta-tools, workers, self-reflection, capabilities). Merge overlapping groups if natural.
- Each summary is ONE sentence with concrete action verbs. Present-tense imperative, no preamble.

GOOD examples:
  "Gmail — read, send, draft, search, and reply to emails; manage labels and threads"
  "Virtual filesystem — read, write, edit, move, copy, delete, and navigate items in the agent's persistent memory store"
  "GitHub — read and write repositories, branches, files, issues, pull requests, reviews, and labels"

BAD examples (do not produce):
  "Provides access to Gmail operations via tools like Gmail_SendEmail..."
  "Tools for working with email"`;

async function summarizeViaLLM(
  inv: RawInventory,
  config: Required<BotholomewConfig>,
): Promise<SummarizedCapabilities | null> {
  if (
    !config.anthropic_api_key ||
    config.anthropic_api_key === "your-api-key-here"
  ) {
    return null;
  }

  const client = new Anthropic({ apiKey: config.anthropic_api_key });
  const userPrompt = `Summarize this tool inventory. Return via the \`${SUMMARIZE_TOOL_NAME}\` tool.\n\n${renderInventoryForPrompt(inv)}`;

  try {
    const response = await client.messages.create(
      {
        model: config.chunker_model,
        max_tokens: SUMMARIZE_MAX_TOKENS,
        system: SUMMARIZE_SYSTEM,
        tools: [SUMMARIZE_TOOL],
        tool_choice: { type: "tool", name: SUMMARIZE_TOOL_NAME },
        messages: [{ role: "user", content: userPrompt }],
      },
      { timeout: SUMMARIZE_TIMEOUT_MS },
    );

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") return null;

    const input = toolBlock.input as SummarizedCapabilities;
    if (!Array.isArray(input.internal_themes)) return null;
    if (!Array.isArray(input.mcpx_servers)) return null;
    return input;
  } catch (err) {
    logger.debug(`Capability summarization failed: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHeader(now: Date): string[] {
  return [
    "# Capabilities",
    "",
    `*Generated ${now.toISOString()}. Regenerate with \`botholomew capabilities\`, the \`capabilities_refresh\` tool, or the \`/capabilities\` skill.*`,
    "",
    "A high-level summary of what this agent can do. Specific tool names are **not** listed — use `mcp_list_tools`, `mcp_search`, or `mcp_info` to find exact names when you need to invoke an external tool.",
    "",
  ];
}

function renderSummarized(
  summary: SummarizedCapabilities,
  inv: RawInventory,
  now: Date,
): string {
  const parts: string[] = [];
  parts.push(...renderHeader(now));

  parts.push("## Internal capabilities");
  parts.push("");
  for (const theme of summary.internal_themes) {
    parts.push(`- **${theme.name}** — ${theme.summary}`);
  }
  parts.push("");

  parts.push("## External capabilities (via MCPX)");
  parts.push("");
  if (!inv.mcpConfigured) {
    parts.push(
      "_No MCPX servers configured. Add one with `botholomew mcpx add` and rerun `botholomew capabilities`._",
    );
  } else if (inv.mcpError) {
    parts.push(
      `_Failed to list MCPX tools: ${inv.mcpError}. Check your MCPX server configuration._`,
    );
  } else if (summary.mcpx_servers.length === 0) {
    parts.push(
      "_MCPX is configured but no tools are exposed by the connected servers._",
    );
  } else {
    for (const srv of summary.mcpx_servers) {
      parts.push(`### ${srv.server}`);
      parts.push("");
      for (const theme of srv.themes) {
        parts.push(`- **${theme.name}** — ${theme.summary}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n").trimEnd();
}

/**
 * Fallback rendering when no API key is set or the LLM call fails.
 * Produces a static high-level summary of internal tools plus a server-level
 * listing for MCPX (with tool counts), still far more compact than listing
 * every tool. The agent uses the MCPX meta-tools to drill in when needed.
 */
function renderFallback(inv: RawInventory, now: Date): string {
  const parts: string[] = [];
  parts.push(...renderHeader(now));

  parts.push("## Internal capabilities");
  parts.push("");
  const fallbackInternal: Record<string, string> = {
    task: "create, list, view, update, complete, fail, and wait on tasks in the agent's work queue",
    schedule:
      "create and list recurring schedules that automatically generate tasks",
    context:
      "read, write, edit, move, copy, delete, and navigate items in the agent's persistent memory store; update beliefs and goals; read large tool results",
    search: "keyword and semantic search over the virtual filesystem",
    thread: "list and view past conversation threads and tool interactions",
    mcp: "search, list, inspect, and execute tools exposed by configured MCPX servers",
    worker: "spawn background workers to run tasks asynchronously",
    capabilities: "refresh this capabilities file (the tool inventory)",
  };
  for (const group of [...GROUP_ORDER, "other" as const]) {
    const tools = inv.internal.get(group);
    if (!tools || tools.length === 0) continue;
    const heading = GROUP_HEADINGS[group] ?? group;
    const summary = fallbackInternal[group] ?? "(no summary)";
    parts.push(`- **${heading}** — ${summary}`);
  }
  parts.push("");

  parts.push("## External capabilities (via MCPX)");
  parts.push("");
  if (!inv.mcpConfigured) {
    parts.push(
      "_No MCPX servers configured. Add one with `botholomew mcpx add` and rerun `botholomew capabilities`._",
    );
  } else if (inv.mcpError) {
    parts.push(
      `_Failed to list MCPX tools: ${inv.mcpError}. Check your MCPX server configuration._`,
    );
  } else if (inv.mcpByServer.size === 0) {
    parts.push(
      "_MCPX is configured but no tools are exposed by the connected servers._",
    );
  } else {
    parts.push(
      "_(LLM summarization unavailable — set `anthropic_api_key` and rerun to generate themed summaries. Until then, use `mcp_list_tools` with each server to see what's exposed.)_",
    );
    parts.push("");
    const servers = [...inv.mcpByServer.keys()].sort();
    for (const server of servers) {
      const tools = inv.mcpByServer.get(server) ?? [];
      parts.push(`- **${server}** — ${tools.length} tool(s)`);
    }
  }

  return parts.join("\n").trimEnd();
}

/**
 * Build the body of capabilities.md. When `config.anthropic_api_key` is set,
 * Claude is asked to produce thematic summaries. Otherwise (or on failure) a
 * static fallback listing is rendered.
 */
export async function generateCapabilitiesMarkdown(
  mcpxClient: McpxClient | null,
  config: Required<BotholomewConfig>,
  now: Date = new Date(),
  onPhase?: ProgressCallback,
): Promise<GenerateResult> {
  const inv = await collectInventory(mcpxClient, onPhase);

  // Don't call the LLM when the inventory is empty / broken — the fallback
  // conveys the same information and avoids an unnecessary API round trip.
  const hasAnythingToSummarize =
    inv.mcpByServer.size > 0 || inv.internalTotal > 0;

  let summary: SummarizedCapabilities | null = null;
  if (hasAnythingToSummarize) {
    const canSummarize =
      config.anthropic_api_key &&
      config.anthropic_api_key !== "your-api-key-here";
    if (canSummarize) {
      onPhase?.(
        `Summarizing ${inv.internalTotal} internal + ${inv.mcpTotal} MCPX tools with Claude`,
      );
    }
    summary = await summarizeViaLLM(inv, config);
  }

  const body = summary
    ? renderSummarized(summary, inv, now)
    : renderFallback(inv, now);

  return {
    body,
    counts: { internal: inv.internalTotal, mcp: inv.mcpTotal },
  };
}

export interface WriteResult {
  path: string;
  counts: CapabilitiesCounts;
  createdFile: boolean;
}

/**
 * Regenerate and write `.botholomew/capabilities.md`. Preserves any existing
 * frontmatter (so a human-edited `loading:` flag survives). On first write
 * the default frontmatter is `loading: always`, `agent-modification: true`.
 */
export async function writeCapabilitiesFile(
  projectDir: string,
  mcpxClient: McpxClient | null,
  config: Required<BotholomewConfig>,
  onPhase?: ProgressCallback,
): Promise<WriteResult> {
  const filePath = join(getBotholomewDir(projectDir), CAPABILITIES_FILENAME);
  const file = Bun.file(filePath);

  let meta: ContextFileMeta = {
    loading: "always",
    "agent-modification": true,
  };
  let createdFile = true;

  if (await file.exists()) {
    const raw = await file.text();
    const parsed = parseContextFile(raw);
    if (parsed.meta && typeof parsed.meta === "object") {
      meta = {
        loading: parsed.meta.loading ?? meta.loading,
        "agent-modification":
          parsed.meta["agent-modification"] ?? meta["agent-modification"],
      };
    }
    createdFile = false;
  }

  const { body, counts } = await generateCapabilitiesMarkdown(
    mcpxClient,
    config,
    new Date(),
    onPhase,
  );
  onPhase?.(`Writing ${CAPABILITIES_FILENAME}`);
  const serialized = serializeContextFile(meta, body);
  await Bun.write(filePath, serialized);

  return { path: filePath, counts, createdFile };
}
