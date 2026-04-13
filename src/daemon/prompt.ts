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

export async function buildSystemPrompt(
  projectDir: string,
  task?: Task,
  conn?: DbConnection,
  _config?: Required<BotholomewConfig>,
): Promise<string> {
  const dotDir = getBotholomewDir(projectDir);
  const parts: string[] = [];

  // Meta information
  parts.push(`# Botholomew v${pkg.version}`);
  parts.push(`Current time: ${new Date().toISOString()}`);
  parts.push(`Project directory: ${projectDir}`);
  parts.push(`OS: ${process.platform} ${process.arch}`);
  parts.push(`User: ${process.env.USER || process.env.USERNAME || "unknown"}`);
  parts.push("");

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
        // Include contextual files if keywords overlap with task
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
  parts.push("");

  return parts.join("\n");
}
