import { isHelpfulError } from "membot";
import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  logical_path: z.string().describe("Logical path to check."),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  exists: z.boolean().optional(),
  logical_path: z.string().optional(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const membotExistsTool = {
  name: "membot_exists",
  description:
    "[[ bash equivalent command: test -e ]] Check whether a logical_path has a current (non-tombstoned) version in the store. Returns `{ exists: true|false }` — never throws on absence. Use before membot_write when you want to avoid clobbering, or to disambiguate a not_found from a real error.",
  group: "membot",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      await ctx.mem.info({ logical_path: input.logical_path });
      return {
        is_error: false,
        exists: true,
        logical_path: input.logical_path,
      };
    } catch (err) {
      if (isHelpfulError(err) && err.kind === "not_found") {
        return {
          is_error: false,
          exists: false,
          logical_path: input.logical_path,
        };
      }
      if (isHelpfulError(err)) {
        return {
          is_error: true,
          error_type: err.kind,
          message: err.message,
        };
      }
      return {
        is_error: true,
        error_type: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
