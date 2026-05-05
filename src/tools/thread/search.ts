import { z } from "zod";
import {
  getThread,
  type Interaction,
  type InteractionKind,
  type InteractionRole,
  listThreads,
  type Thread,
} from "../../threads/store.ts";
import type { ToolDefinition } from "../tool.ts";

const ROLES = ["user", "assistant", "system", "tool"] as const;
const KINDS = [
  "message",
  "thinking",
  "tool_use",
  "tool_result",
  "context_update",
  "status_change",
] as const;

const SNIPPET_MAX = 240;

const inputSchema = z.object({
  pattern: z
    .string()
    .describe(
      "Regex pattern matched against each interaction's `content`. Use a plain substring (it's a regex, but plain text Just Works).",
    ),
  ignore_case: z
    .boolean()
    .optional()
    .default(true)
    .describe("Case-insensitive regex (default true)."),
  role: z
    .enum(ROLES)
    .optional()
    .describe(
      "Restrict matches to a single role (user/assistant/system/tool).",
    ),
  kind: z
    .enum(KINDS)
    .optional()
    .describe(
      "Restrict matches to a single interaction kind (message/tool_use/tool_result/etc).",
    ),
  thread_type: z
    .enum(["worker_tick", "chat_session"])
    .optional()
    .describe("Restrict to chat sessions or worker-tick threads."),
  since: z
    .string()
    .optional()
    .describe("ISO date — only consider threads started on or after this."),
  until: z
    .string()
    .optional()
    .describe("ISO date — only consider threads started on or before this."),
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .describe("Maximum number of hits to return across all threads."),
});

const HitSchema = z.object({
  thread_id: z.string(),
  thread_title: z.string(),
  thread_type: z.string(),
  sequence: z
    .number()
    .describe(
      "1-based sequence of the matching interaction in the thread. Plug this into `view_thread({ id, offset: sequence-1, limit: 5 })` to read context around the hit.",
    ),
  role: z.string(),
  kind: z.string(),
  content_snippet: z.string(),
  created_at: z.string(),
});

const outputSchema = z.object({
  matches: z.array(HitSchema),
  threads_scanned: z.number(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const searchThreadsTool = {
  name: "search_threads",
  description:
    "[[ bash equivalent command: grep -r ]] Search past conversations (chat sessions and worker ticks) for a regex match. Returns hits with `(thread_id, sequence)` pairs — pass them to `view_thread` to read context around the match.",
  group: "thread",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, input.ignore_case ? "i" : "");
    } catch (err) {
      return {
        matches: [],
        threads_scanned: 0,
        is_error: true,
        error_type: "invalid_regex",
        message: `Could not compile pattern: ${err instanceof Error ? err.message : String(err)}`,
        next_action_hint:
          "Double-check the regex; remember `.` is a metacharacter — escape it as `\\.` for a literal dot.",
      };
    }

    const sinceMs = input.since
      ? Date.parse(input.since)
      : Number.NEGATIVE_INFINITY;
    const untilMs = input.until
      ? Date.parse(input.until)
      : Number.POSITIVE_INFINITY;

    let threads: Thread[];
    try {
      threads = await listThreads(ctx.projectDir, {
        type: input.thread_type,
      });
    } catch (err) {
      return {
        matches: [],
        threads_scanned: 0,
        is_error: true,
        error_type: "list_failed",
        message: `Failed to enumerate threads: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    type Hit = z.infer<typeof HitSchema>;
    const matches: Hit[] = [];
    let scanned = 0;

    for (const t of threads) {
      const startedMs = t.started_at.getTime();
      if (startedMs < sinceMs || startedMs > untilMs) continue;
      const data = await getThread(ctx.projectDir, t.id);
      if (!data) continue;
      scanned++;
      for (const ix of data.interactions) {
        if (input.role && ix.role !== input.role) continue;
        if (input.kind && ix.kind !== input.kind) continue;
        if (!matchInteraction(ix, regex)) continue;
        matches.push({
          thread_id: t.id,
          thread_title: t.title || "(untitled)",
          thread_type: t.type,
          sequence: ix.sequence,
          role: ix.role,
          kind: ix.kind,
          content_snippet: snippetForMatch(ix.content, regex),
          created_at: ix.created_at.toISOString(),
        });
        if (matches.length >= input.max_results) break;
      }
      if (matches.length >= input.max_results) break;
    }

    return {
      matches,
      threads_scanned: scanned,
      is_error: false,
      next_action_hint:
        matches.length === 0
          ? `No hits in ${scanned} thread(s). Try a broader pattern or remove role/kind filters.`
          : `Pass any (thread_id, sequence) into view_thread({ id: thread_id, offset: sequence - 1, limit: 5 }) to read surrounding context.`,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;

function matchInteraction(ix: Interaction, regex: RegExp): boolean {
  // We treat the user-visible content as the primary haystack, but a
  // tool_use interaction's content is just "Calling <name>" — fall through
  // to the tool name + JSON args so a search for an exact tool argument
  // still finds the call.
  if (regex.test(ix.content)) return true;
  if (ix.tool_name && regex.test(ix.tool_name)) return true;
  if (ix.tool_input && regex.test(ix.tool_input)) return true;
  return false;
}

/**
 * Pick a short window around the first regex match so the agent gets enough
 * context to know whether the hit is relevant without paging the whole
 * interaction. Falls back to the head when the match index isn't available.
 */
function snippetForMatch(content: string, regex: RegExp): string {
  const m = regex.exec(content);
  if (!m) return content.slice(0, SNIPPET_MAX);
  const idx = m.index;
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + SNIPPET_MAX - 60);
  let snippet = content.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < content.length) snippet = `${snippet}…`;
  return snippet;
}

// Keep the role/kind unions exported for tests that want to type-pin filters.
export type SearchThreadsRole = InteractionRole;
export type SearchThreadsKind = InteractionKind;
