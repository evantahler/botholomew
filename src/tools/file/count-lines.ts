import { z } from "zod";
import { getContextItemByPath } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path"),
});

const outputSchema = z.object({
  lines: z.number(),
  is_error: z.boolean(),
});

export const contextCountLinesTool = {
  name: "context_count_lines",
  description: "Count the number of lines in a text context item.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const item = await getContextItemByPath(ctx.conn, input.path);
    if (!item) throw new Error(`Not found: ${input.path}`);
    if (item.content == null) throw new Error(`No text content: ${input.path}`);

    return { lines: item.content.split("\n").length, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
