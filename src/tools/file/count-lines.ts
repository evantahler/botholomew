import { z } from "zod";
import { getContextItemByPath } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path"),
});

const outputSchema = z.object({
  lines: z.number(),
});

export const fileCountLinesTool = {
  name: "file_count_lines",
  description: "Count the number of lines in a text file.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const item = await getContextItemByPath(ctx.conn, input.path);
    if (!item) throw new Error(`Not found: ${input.path}`);
    if (item.content == null) throw new Error(`No text content: ${input.path}`);

    return { lines: item.content.split("\n").length };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
