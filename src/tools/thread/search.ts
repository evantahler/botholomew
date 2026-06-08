import { z } from "zod";
import {
  type InteractionKind,
  type InteractionRole,
  searchThreads,
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

    let scanResult: Awaited<ReturnType<typeof searchThreads>>;
    try {
      scanResult = await searchThreads(ctx.projectDir, {
        regex,
        role: input.role,
        kind: input.kind,
        type: input.thread_type,
        since: input.since ? new Date(input.since) : undefined,
        until: input.until ? new Date(input.until) : undefined,
        maxResults: input.max_results,
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

    const matches = scanResult.hits.map((h) => ({
      thread_id: h.thread_id,
      thread_title: h.thread_title,
      thread_type: h.thread_type,
      sequence: h.sequence,
      role: h.role,
      kind: h.kind,
      content_snippet: h.content_snippet,
      created_at: h.created_at.toISOString(),
    }));

    return {
      matches,
      threads_scanned: scanResult.threadsScanned,
      is_error: false,
      next_action_hint:
        matches.length === 0
          ? `No hits in ${scanResult.threadsScanned} thread(s). Try a broader pattern or remove role/kind filters.`
          : `Pass any (thread_id, sequence) into view_thread({ id: thread_id, offset: sequence - 1, limit: 5 }) to read surrounding context.`,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;

// Keep the role/kind unions exported for tests that want to type-pin filters.
export type SearchThreadsRole = InteractionRole;
export type SearchThreadsKind = InteractionKind;
