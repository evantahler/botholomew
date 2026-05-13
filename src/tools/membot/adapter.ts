import type { Operation } from "membot";
import { composeDescription, isHelpfulError } from "membot";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../tool.ts";

/**
 * Common output envelope for every membot-backed tool. The membot operation's
 * own result is parked under `data` so the LLM gets a single, predictable
 * shape across all 14 verbs. Errors flatten the HelpfulError's `kind`/`hint`
 * into `error_type` / `next_action_hint`, which is the recovery cue Botholomew
 * agents already know from the rest of the tool surface.
 */
export const membotOutputSchema = z.object({
  is_error: z.boolean(),
  data: z.unknown().optional(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export type MembotOutput = z.infer<typeof membotOutputSchema>;

type MembotMethodName =
  | "add"
  | "list"
  | "tree"
  | "read"
  | "search"
  | "info"
  | "stats"
  | "versions"
  | "diff"
  | "write"
  | "move"
  | "remove"
  | "refresh"
  | "prune"
  | "sources";

/**
 * Map an Operation's exposed name (`membot_add`, `membot_remove`, …) to the
 * `MembotClient` method that actually runs it. Mostly 1:1 with the op name
 * minus the `membot_` prefix; kept explicit so a renamed/added op fails
 * loudly at registration instead of silently misrouting.
 */
const METHOD_BY_OP_NAME: Record<string, MembotMethodName> = {
  membot_add: "add",
  membot_list: "list",
  membot_tree: "tree",
  membot_read: "read",
  membot_search: "search",
  membot_info: "info",
  membot_stats: "stats",
  membot_versions: "versions",
  membot_diff: "diff",
  membot_write: "write",
  membot_move: "move",
  membot_remove: "remove",
  membot_refresh: "refresh",
  membot_prune: "prune",
  membot_sources: "sources",
};

/**
 * Adapt one membot {@link Operation} into a Botholomew {@link ToolDefinition}.
 * The input schema passes through unchanged so the LLM sees membot's
 * upstream prose/aliases verbatim. Success calls return `{ is_error: false,
 * data: <op output> }`; HelpfulErrors return the flattened error envelope.
 * Unknown errors are wrapped as `internal_error` so a thrown handler never
 * crashes the agent loop.
 */
export function adaptOperation(
  // biome-ignore lint/suspicious/noExplicitAny: Operation generic is heterogeneous across 14 verbs
  op: Operation<any, any>,
): ToolDefinition<z.ZodObject<z.ZodRawShape>, typeof membotOutputSchema> {
  const methodName = METHOD_BY_OP_NAME[op.name];
  if (!methodName) {
    throw new Error(
      `adaptOperation: no MembotClient method registered for op '${op.name}'. ` +
        `Add it to METHOD_BY_OP_NAME in src/tools/membot/adapter.ts.`,
    );
  }
  return {
    name: op.name,
    description: composeDescription(op),
    group: "membot",
    inputSchema: op.inputSchema as z.ZodObject<z.ZodRawShape>,
    outputSchema: membotOutputSchema,
    execute: async (input, ctx: ToolContext) => {
      try {
        const data = await ctx.withMem(async (mem) => {
          const method = mem[methodName] as (i: unknown) => Promise<unknown>;
          return method.call(mem, input);
        });
        return { is_error: false, data };
      } catch (err) {
        if (isHelpfulError(err)) {
          return {
            is_error: true,
            error_type: err.kind,
            message: err.message,
            next_action_hint: err.hint,
          };
        }
        return {
          is_error: true,
          error_type: "internal_error",
          message: err instanceof Error ? err.message : String(err),
          next_action_hint:
            "Check the project's membot store (run `botholomew membot stats`) and try again. If this persists, file a bug.",
        };
      }
    },
  };
}
