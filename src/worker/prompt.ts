import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getBotholomewDir } from "../constants.ts";
import { embedSingle } from "../context/embedder.ts";
import { withDb } from "../db/connection.ts";
import { hybridSearch } from "../db/embeddings.ts";
import type { Task } from "../db/tasks.ts";
import { parseContextFile } from "../utils/frontmatter.ts";
import { logger } from "../utils/logger.ts";

const pkg = await Bun.file(
  new URL("../../package.json", import.meta.url),
).json();

export const STYLE_RULES = `## Style
- Open with the result, action, or next step. Skip preambles like "Great question", "You're absolutely right", "Let me…", "I'll go ahead and…".
- Don't flatter the user or their ideas. If a request is wrong, ambiguous, or risky, say so plainly with the reason.
- Hold your position when you have one. Don't capitulate to pushback that brings no new evidence.
- Be terse. Don't restate what you just did or are about to do — show it.
- Report failures and uncertainty directly. Don't paper over gaps with confident prose.
`;

/**
 * Extract keyword set from free-form text: lowercase, split on whitespace,
 * keep words longer than 3 chars. Used to match `loading: contextual` files
 * against the agent's current intent (task text for the worker, latest user
 * message for the chat).
 */
export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/**
 * Load persistent context files from .botholomew/ directory as a single
 * formatted string. Includes "always" files unconditionally and "contextual"
 * files whose content overlaps the provided taskKeywords.
 */
export async function loadPersistentContext(
  projectDir: string,
  taskKeywords?: Set<string> | null,
): Promise<string> {
  const dotDir = getBotholomewDir(projectDir);
  let out = "";

  try {
    const files = await readdir(dotDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    for (const filename of mdFiles) {
      const filePath = join(dotDir, filename);
      const raw = await Bun.file(filePath).text();
      const { meta, content } = parseContextFile(raw);

      if (meta.loading === "always") {
        out += `## ${filename}\n${content}\n\n`;
      } else if (meta.loading === "contextual" && taskKeywords) {
        const contentLower = content.toLowerCase();
        const hasOverlap = [...taskKeywords].some((kw) =>
          contentLower.includes(kw),
        );
        if (hasOverlap) {
          out += `## ${filename} (contextual)\n${content}\n\n`;
        }
      }
    }
  } catch {
    // .botholomew dir might not have md files yet
  }

  return out;
}

/**
 * Build common meta header (version, time, OS, user).
 */
export function buildMetaHeader(projectDir: string): string {
  return `# Botholomew v${pkg.version}
Current time: ${new Date().toISOString()}
Project directory: ${projectDir}
OS: ${process.platform} ${process.arch}
User: ${process.env.USER || process.env.USERNAME || "unknown"}

`;
}

export async function buildSystemPrompt(
  projectDir: string,
  task?: Task,
  dbPath?: string,
  _config?: Required<BotholomewConfig>,
  options?: { hasMcpTools?: boolean },
): Promise<string> {
  let prompt = buildMetaHeader(projectDir);

  const taskKeywords = task
    ? extractKeywords(`${task.name} ${task.description}`)
    : null;

  prompt += await loadPersistentContext(projectDir, taskKeywords);

  if (task && dbPath && _config?.openai_api_key) {
    try {
      const query = `${task.name} ${task.description}`;
      const queryVec = await embedSingle(query, _config);
      const results = await withDb(dbPath, (conn) =>
        hybridSearch(conn, query, queryVec, 5),
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
You are Botholomew, a wise-owl worker that works through tasks. Use available tools to complete your assigned task, then call complete_task, fail_task, or wait_task. Use create_task for subtasks and update_task to refine pending tasks. Batch independent tool calls in a single response for parallel execution.

When calling complete_task, write a summary that captures your key findings, decisions, and outputs. This summary becomes the task's output and is provided to any downstream tasks that depend on this one. Include specific results (data, names, paths, conclusions) rather than vague descriptions of what you did — downstream tasks will rely on this information to do their work.
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
