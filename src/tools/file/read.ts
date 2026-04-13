import { z } from "zod";
import { getContextItemByPath } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path to read"),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Maximum number of lines to return"),
});

const outputSchema = z.object({
  content: z.string(),
});

export const fileReadTool = {
  name: "file_read",
  description: "Read a file's contents from the virtual filesystem.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const item = await getContextItemByPath(ctx.conn, input.path);
    if (!item) throw new Error(`Not found: ${input.path}`);
    if (item.content == null) throw new Error(`No text content: ${input.path}`);

    let content = item.content;

    if (input.offset || input.limit) {
      const lines = content.split("\n");
      const start = (input.offset ?? 1) - 1;
      const end = input.limit ? start + input.limit : lines.length;
      content = lines.slice(start, end).join("\n");
    }

    return { content };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
