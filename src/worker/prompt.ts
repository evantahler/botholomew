import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SERVER_INSTRUCTIONS as MEMBOT_INSTRUCTIONS } from "membot";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getPromptsDir } from "../constants.ts";
import type { Task } from "../tasks/schema.ts";
import { parsePromptFile } from "../utils/frontmatter.ts";

/**
 * Section header rendered above membot's upstream {@link MEMBOT_INSTRUCTIONS}
 * blob in every system prompt. Pulling the body verbatim from the SDK keeps
 * the agent's mental model of `membot_*` tools aligned with whatever the
 * pinned membot version ships, with no per-bump prose edits on our side.
 */
export const MEMBOT_PROMPT_SECTION = `## Knowledge store (membot)

${MEMBOT_INSTRUCTIONS}
`;

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
 * Load persistent context files from prompts/ as a single formatted
 * string. Includes "always" files unconditionally and "contextual" files
 * whose content overlaps the provided taskKeywords.
 *
 * Validation is strict: any *.md file under prompts/ that fails the prompt
 * frontmatter schema throws PromptValidationError naming the offending file.
 * The only swallowed error is a missing prompts/ directory (e.g. fresh
 * working dir before `botholomew init`).
 */
export async function loadPersistentContext(
  projectDir: string,
  taskKeywords?: Set<string> | null,
): Promise<string> {
  const dir = getPromptsDir(projectDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

  let out = "";
  for (const filename of mdFiles) {
    const filePath = join(dir, filename);
    const raw = await Bun.file(filePath).text();
    const { meta, content } = parsePromptFile(filePath, raw);

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

  return out;
}

/**
 * Build common meta header (version, time, OS, user).
 */
export function buildMetaHeader(projectDir: string): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  });
  return `# Botholomew v${pkg.version}
Current time (UTC): ${now.toISOString()}
Current time (local): ${localTime}
Timezone: ${timezone}
Project directory: ${projectDir}
OS: ${process.platform} ${process.arch}
User: ${process.env.USER || process.env.USERNAME || "unknown"}

`;
}

export async function buildSystemPrompt(
  projectDir: string,
  task?: Task,
  _config?: Required<BotholomewConfig>,
  options?: { hasMcpTools?: boolean },
): Promise<string> {
  let prompt = buildMetaHeader(projectDir);

  const taskKeywords = task
    ? extractKeywords(`${task.name} ${task.description}`)
    : null;

  prompt += await loadPersistentContext(projectDir, taskKeywords);

  // The agent finds task-relevant content via the `membot_search` tool on
  // demand rather than having chunks pre-stuffed into the system prompt —
  // keeps the prompt small and lets the model decide what to read.
  void task;
  void _config;

  prompt += `## Instructions
You are Botholomew, a wise-owl worker that works through tasks. Use available tools to complete your assigned task, then call complete_task, fail_task, or wait_task. Use create_task for subtasks and update_task to refine pending tasks. Batch independent tool calls in a single response for parallel execution.

When calling complete_task, write a summary that captures your key findings, decisions, and outputs. This summary becomes the task's output and is provided to any downstream tasks that depend on this one. Include specific results (data, names, paths, conclusions) rather than vague descriptions of what you did — downstream tasks will rely on this information to do their work.
`;

  prompt += `\n${MEMBOT_PROMPT_SECTION}`;

  if (options?.hasMcpTools) {
    prompt += `
## External Tools (MCP)

### Local knowledge store first

**Before any MCP read, search the membot knowledge store.** Prior ingests (Gmail dumps, GitHub fetches, URL captures, prior agent outputs) are usually already there — refetching is slower, costs tokens, and risks rate limits.

Workflow for any "look up / find / read" intent:

1. \`membot_search\` (hybrid semantic + BM25) over the store, then \`membot_read\` / \`membot_tree\` to drill in.
2. If freshness matters, call \`membot_info\` and check the source mtime / refresh status. To re-pull stale content, call \`membot_refresh\` for URL-backed entries, or \`membot_pipe\` from an \`mcp_exec\` call for fresh captures.
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
