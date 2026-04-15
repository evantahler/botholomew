import { z } from "zod";
import { readLargeResultPage } from "../../daemon/large-results.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("The large result ID (e.g. lr_1)"),
  page: z.number().int().min(1).describe("Page number to read (1-based)"),
});

const outputSchema = z.object({
  content: z.string(),
  page: z.number(),
  totalPages: z.number(),
  is_error: z.boolean(),
});

export const readLargeResultTool = {
  name: "read_large_result",
  description:
    "Read a page from a large tool result that was too big to display inline. Use this to paginate through stored results.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input) => {
    const result = readLargeResultPage(input.id, input.page);
    if (!result) {
      throw new Error(
        `No result found for id="${input.id}" page=${input.page}. The id may be invalid or the page may be out of range.`,
      );
    }
    return { ...result, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
