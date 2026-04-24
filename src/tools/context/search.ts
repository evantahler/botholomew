import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
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
      drive: z.string(),
      path: z.string(),
      ref: z.string(),
      content_preview: z.string(),
    }),
  ),
  count: z.number(),
  is_error: z.boolean(),
});

export const contextSearchTool = {
  name: "context_search",
  description:
    "[[ bash equivalent command: grep -r ]] Search context by keyword across all drives.",
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
        drive: item.drive,
        path: item.path,
        ref: formatDriveRef(item),
        content_preview: (item.content ?? "").slice(0, 500),
      })),
      count: items.length,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
