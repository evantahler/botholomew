import { join } from "node:path";
import type { McpxClient } from "@evantahler/mcpx";
import { getBotholomewDir } from "../constants.ts";
import { getAllTools } from "../tools/tool.ts";
import {
  type ContextFileMeta,
  parseContextFile,
  serializeContextFile,
} from "../utils/frontmatter.ts";

export const CAPABILITIES_FILENAME = "capabilities.md";

/**
 * Groups rendered in capabilities.md, in the order they appear. Anything
 * registered under a group not in this list is appended under "other".
 */
const GROUP_ORDER = [
  "task",
  "schedule",
  "context",
  "search",
  "thread",
  "mcp",
  "worker",
] as const;

const GROUP_HEADINGS: Record<string, string> = {
  task: "Task management",
  schedule: "Schedules",
  context: "Context / virtual filesystem",
  search: "Search",
  thread: "Threads",
  mcp: "MCP (external tools)",
  worker: "Workers",
  other: "Other",
};

const BASH_TAG_RE = /^\[\[\s*bash equivalent command:\s*([^\]]+?)\s*\]\]\s*/;

function summarizeDescription(raw: string): {
  bashAnalog: string | null;
  summary: string;
} {
  const match = raw.match(BASH_TAG_RE);
  const bashAnalog = match?.[1]?.trim() ?? null;
  const stripped = match ? raw.slice(match[0].length) : raw;
  const firstSentence = stripped.split(/(?<=\.)\s+/)[0] ?? stripped;
  return { bashAnalog, summary: firstSentence.trim() };
}

export interface CapabilitiesCounts {
  internal: number;
  mcp: number;
}

export interface GenerateResult {
  body: string;
  counts: CapabilitiesCounts;
}

/**
 * Build the body of capabilities.md. Internal tools are pulled from the
 * registry; MCPX tools are enumerated only when `mcpxClient` is non-null.
 */
export async function generateCapabilitiesMarkdown(
  mcpxClient: McpxClient | null,
  now: Date = new Date(),
): Promise<GenerateResult> {
  const allTools = getAllTools();
  const grouped = new Map<string, typeof allTools>();
  for (const tool of allTools) {
    const key = (GROUP_ORDER as readonly string[]).includes(tool.group)
      ? tool.group
      : "other";
    const list = grouped.get(key) ?? [];
    list.push(tool);
    grouped.set(key, list);
  }

  const parts: string[] = [];
  parts.push("# Capabilities");
  parts.push("");
  parts.push(
    `*Generated ${now.toISOString()}. Regenerate with \`botholomew context capabilities\`, the \`capabilities_refresh\` tool, or the \`/context\` skill.*`,
  );
  parts.push("");
  parts.push(
    "This is a pre-scanned inventory of every tool available in this project — both the built-in Botholomew tools and any tools exposed through configured MCPX servers. Consult this file before searching for tools; it is always loaded into the system prompt.",
  );
  parts.push("");
  parts.push("## Internal tools");
  parts.push("");

  const renderedGroups = [...GROUP_ORDER, "other" as const];
  for (const group of renderedGroups) {
    const tools = grouped.get(group);
    if (!tools || tools.length === 0) continue;
    parts.push(`### ${GROUP_HEADINGS[group] ?? group}`);
    parts.push("");
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    for (const tool of sorted) {
      const { bashAnalog, summary } = summarizeDescription(tool.description);
      const suffix = bashAnalog ? ` _(≈ \`${bashAnalog}\`)_` : "";
      parts.push(`- **\`${tool.name}\`** — ${summary}${suffix}`);
    }
    parts.push("");
  }

  let mcpCount = 0;
  parts.push("## MCPX tools");
  parts.push("");
  if (!mcpxClient) {
    parts.push(
      "_No MCPX servers configured. Add one with `botholomew mcpx add` and rerun `botholomew context capabilities`._",
    );
    parts.push("");
  } else {
    let mcpTools: Awaited<ReturnType<McpxClient["listTools"]>>;
    try {
      mcpTools = await mcpxClient.listTools();
    } catch (err) {
      parts.push(
        `_Failed to list MCPX tools: ${(err as Error).message}. Check your MCPX server configuration._`,
      );
      parts.push("");
      return {
        body: parts.join("\n"),
        counts: { internal: allTools.length, mcp: 0 },
      };
    }

    if (mcpTools.length === 0) {
      parts.push(
        "_MCPX is configured but no tools are exposed by the connected servers._",
      );
      parts.push("");
    } else {
      const byServer = new Map<string, typeof mcpTools>();
      for (const entry of mcpTools) {
        const list = byServer.get(entry.server) ?? [];
        list.push(entry);
        byServer.set(entry.server, list);
      }
      const servers = [...byServer.keys()].sort();
      for (const server of servers) {
        const tools = byServer.get(server) ?? [];
        parts.push(`### ${server}`);
        parts.push("");
        const sorted = [...tools].sort((a, b) =>
          a.tool.name.localeCompare(b.tool.name),
        );
        for (const entry of sorted) {
          const desc = entry.tool.description?.trim() ?? "";
          const summary = desc.split(/(?<=\.)\s+/)[0] ?? desc;
          parts.push(
            `- **\`${entry.tool.name}\`** — ${summary || "(no description provided)"}`,
          );
        }
        parts.push("");
      }
      mcpCount = mcpTools.length;
    }
  }

  return {
    body: parts.join("\n").trimEnd(),
    counts: { internal: allTools.length, mcp: mcpCount },
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

  const { body, counts } = await generateCapabilitiesMarkdown(mcpxClient);
  const serialized = serializeContextFile(meta, body);
  await Bun.write(filePath, serialized);

  return { path: filePath, counts, createdFile };
}
