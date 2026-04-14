import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getBotholomewDir } from "../constants.ts";
import { embedSingle } from "../context/embedder.ts";
import type { DbConnection } from "../db/connection.ts";
import { hybridSearch, initVectorSearch } from "../db/embeddings.ts";
import type { Task } from "../db/tasks.ts";
import { parseContextFile } from "../utils/frontmatter.ts";
import { logger } from "../utils/logger.ts";

const pkg = await Bun.file(
  new URL("../../package.json", import.meta.url),
).json();

/**
 * Load persistent context files from .botholomew/ directory.
 * Returns an array of formatted string sections for "always" loaded files.
 * If taskKeywords are provided, also includes "contextual" files that match.
 */
export async function loadPersistentContext(
  projectDir: string,
  taskKeywords?: Set<string> | null,
): Promise<string[]> {
  const dotDir = getBotholomewDir(projectDir);
  const parts: string[] = [];

  try {
    const files = await readdir(dotDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    for (const filename of mdFiles) {
      const filePath = join(dotDir, filename);
      const raw = await Bun.file(filePath).text();
      const { meta, content } = parseContextFile(raw);

      if (meta.loading === "always") {
        parts.push(`## ${filename}`);
        parts.push(content);
        parts.push("");
      } else if (meta.loading === "contextual" && taskKeywords) {
        const contentLower = content.toLowerCase();
        const hasOverlap = [...taskKeywords].some((kw) =>
          contentLower.includes(kw),
        );
        if (hasOverlap) {
          parts.push(`## ${filename} (contextual)`);
          parts.push(content);
          parts.push("");
        }
      }
    }
  } catch {
    // .botholomew dir might not have md files yet
  }

  return parts;
}

/**
 * Build common meta header (version, time, OS, user).
 */
export function buildMetaHeader(projectDir: string): string[] {
  return [
    `# Botholomew v${pkg.version}`,
    `Current time: ${new Date().toISOString()}`,
    `Project directory: ${projectDir}`,
    `OS: ${process.platform} ${process.arch}`,
    `User: ${process.env.USER || process.env.USERNAME || "unknown"}`,
    "",
  ];
}

export async function buildSystemPrompt(
  projectDir: string,
  task?: Task,
  conn?: DbConnection,
  _config?: Required<BotholomewConfig>,
  options?: { hasMcpTools?: boolean },
): Promise<string> {
  const parts: string[] = [];

  // Meta information
  parts.push(...buildMetaHeader(projectDir));

  // Build keyword set from task for contextual loading
  const taskKeywords = task
    ? new Set(
        `${task.name} ${task.description}`
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3),
      )
    : null;

  // Load context files from .botholomew/
  parts.push(...(await loadPersistentContext(projectDir, taskKeywords)));

  // Relevant context from embeddings search
  if (task && conn) {
    try {
      const query = `${task.name} ${task.description}`;
      const queryVec = await embedSingle(query);
      initVectorSearch(conn);
      const results = hybridSearch(conn, query, queryVec, 5);

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

  // Instructions
  parts.push("## Instructions");
  parts.push(
    "You are the Botholomew daemon. You wake up periodically to work through tasks.",
  );
  parts.push("When given a task, use the available tools to complete it.");
  parts.push(
    "Always call complete_task, fail_task, or wait_task when you are done.",
  );
  parts.push("If you need to create subtasks, use create_task.");
  if (options?.hasMcpTools) {
    parts.push("");
    parts.push("## External Tools (MCP)");
    parts.push(
      "You have access to external tools via MCP servers. Use `mcp_list_tools` or `mcp_search` to discover available tools, `mcp_info` to get a tool's input schema, then `mcp_exec` to call them.",
    );
  }
  parts.push("");

  return parts.join("\n");
}
