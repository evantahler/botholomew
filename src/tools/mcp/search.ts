import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  query: z.string().describe("Search query for finding MCP tools"),
});

const SearchResultSchema = z.object({
  server: z.string(),
  tool: z.string(),
  description: z.string(),
  score: z.number(),
});

const outputSchema = z.object({
  results: z.array(SearchResultSchema),
});

export const mcpSearchTool = {
  name: "mcp_search",
  description:
    "Search for MCP tools by keyword and/or semantic similarity. Requires a pre-built search index (run `botholomew mcpx index`).",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!ctx.mcpxClient) {
      return { results: [] };
    }

    try {
      const results = await ctx.mcpxClient.search(input.query);
      return {
        results: results.map((r) => ({
          server: r.server,
          tool: r.tool,
          description: r.description ?? "",
          score: r.score,
        })),
      };
    } catch {
      return { results: [] };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
