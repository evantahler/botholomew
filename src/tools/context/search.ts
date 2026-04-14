import { z } from "zod";
import { searchContextByKeyword } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  query: z
    .string()
    .describe("Search query (keyword match on title and content)"),
  limit: z.number().optional().describe("Max results (default 20)"),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      context_path: z.string(),
      content_preview: z.string(),
    }),
  ),
  count: z.number(),
});

export const searchContextTool = {
  name: "search_context",
  description: "Search the context database by keyword.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const items = await searchContextByKeyword(
      ctx.conn,
      input.query,
      input.limit,
    );
    return {
      results: items.map((item) => ({
        id: item.id,
        title: item.title,
        context_path: item.context_path,
        content_preview: (item.content ?? "").slice(0, 500),
      })),
      count: items.length,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
