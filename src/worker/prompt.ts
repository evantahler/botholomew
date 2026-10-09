import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SERVER_INSTRUCTIONS as MEMBOT_INSTRUCTIONS } from "membot";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getPromptsDir } from "../constants.ts";
import { pkg } from "../pkg.ts";
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

/**
 * Teaches the `membot_pipe` / `membot_run` pattern for large JSON. Shared
 * verbatim by the worker and chat prompts (chat imports it). These are core
 * knowledge-store tools — not MCP-only — so the section renders unconditionally;
 * without it the model only learns about `membot_run` from its tool schema,
 * exactly when it's most context-pressured (holding a big blob).
 */
export const LARGE_JSON_SECTION = `## Large JSON results
When a tool would return a large JSON payload (mcp_exec dumps, search results, web fetches) that you don't need to read verbatim, don't pull it into context:
1. Land the bytes with \`membot_pipe\` or, inside a program, \`mcp.capture\` — you get back only an ack.
2. Reduce with \`membot_run\`: write TypeScript against \`files.*\` (and \`mcp.*\` when you need a fresh fetch). Return a small value, or write with \`files.writeJson\` / \`output_logical_path\`. Pass \`source="?"\` for the host API.
For multi-step fetch-and-reduce work, prefer one \`membot_run\` over many conversational \`mcp_exec\` calls.
`;

/**
 * Guidance on when to consult the membot store vs. call MCP directly. Shared
 * verbatim by the worker and chat prompts. Deliberately soft: the store is a
 * cache worth checking when a request plausibly touches previously-ingested
 * content, not a mandatory first hop for every read.
 */
export const KNOWLEDGE_VS_MCP_SECTION = `### Knowledge store vs. live data

The membot store may already hold relevant content (prior ingests, URL captures, earlier agent outputs). Use judgment about whether to check it — it's not a required first step.

- Check membot (\`membot_search\`, then \`membot_read\` / \`membot_tree\`) when the request refers to something you or the user likely saved before, or when refetching would be expensive (large dumps, rate-limited APIs).
- Go straight to \`mcp_exec\` when the user wants current/live data, names a specific external source, or the request is clearly about something new. If a store lookup comes up empty, move on rather than retrying variations.
- If you do use stored content and freshness matters, check \`membot_info\`; re-pull with \`membot_refresh\` (URL-backed entries) or \`membot_pipe\` from an \`mcp_exec\` call.

Writes to external systems (sending an email, creating an issue, posting to Slack) always go through MCP directly.
`;

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
  _config?: BotholomewConfig,
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

Always end your tick by calling exactly one terminal status tool — never just stop. Call complete_task ONLY if the required deliverable actually exists (verify it). If you are blocked or a required tool/capability is unavailable (e.g. no way to produce the requested output), call fail_task and state the gap — do not pretend success. If you must wait on something external, call wait_task.

When calling complete_task, write a summary that captures your key findings, decisions, and outputs. This summary becomes the task's output and is provided to any downstream tasks that depend on this one. Include specific results (data, names, paths, conclusions) rather than vague descriptions of what you did — downstream tasks will rely on this information to do their work.
`;

  prompt += `\n${MEMBOT_PROMPT_SECTION}`;
  prompt += `\n${LARGE_JSON_SECTION}`;

  if (options?.hasMcpTools) {
    prompt += `
## External Tools (MCP)

${KNOWLEDGE_VS_MCP_SECTION}
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
