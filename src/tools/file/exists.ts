import { z } from "zod";
import { resolveContextItem } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path or context item ID"),
});

const outputSchema = z.object({
  exists: z.boolean(),
  is_error: z.boolean(),
});

export const contextExistsTool = {
  name: "context_exists",
  description: "Check if a context item exists.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const item = await resolveContextItem(ctx.conn, input.path);
    return { exists: item !== null, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
