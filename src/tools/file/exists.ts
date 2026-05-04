import { z } from "zod";
import { fileExists } from "../../context/store.ts";
import { PathEscapeError } from "../../fs/sandbox.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Path under context/"),
});

const outputSchema = z.object({
  exists: z.boolean(),
  is_error: z.boolean(),
});

export const contextExistsTool = {
  name: "context_exists",
  description:
    "[[ bash equivalent command: test -e ]] Check whether a path exists under context/.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const exists = await fileExists(ctx.projectDir, input.path);
      return { exists, is_error: false };
    } catch (err) {
      if (err instanceof PathEscapeError) {
        return { exists: false, is_error: false };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
