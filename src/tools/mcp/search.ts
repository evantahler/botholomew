import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  query: z.string().describe("Search query for finding MCP tools"),
  keyword_only: z
    .boolean()
    .optional()
    .describe("Only use keyword matching (skip semantic search)"),
  semantic_only: z
    .boolean()
    .optional()
    .describe("Only use semantic matching (skip keyword search)"),
});

const SearchResultSchema = z.object({
  server: z.string(),
  tool: z.string(),
  description: z.string(),
  score: z.number(),
  match_type: z.string(),
});

const outputSchema = z.object({
  results: z.array(SearchResultSchema),
});

export const mcpSearchTool = {
  name: "mcp_search",
  description:
    "Search for MCP tools by keyword, semantic similarity, or both. By default uses hybrid search (keyword + semantic). Set keyword_only=true for exact term matching or semantic_only=true for meaning-based similarity. Requires a pre-built search index (run `botholomew mcpx index`).",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!ctx.mcpxClient) {
      return { results: [] };
    }

    try {
      const results = await ctx.mcpxClient.search(input.query, {
        keywordOnly: input.keyword_only,
        semanticOnly: input.semantic_only,
      });
      return {
        results: results.map((r) => ({
          server: r.server,
          tool: r.tool,
          description: r.description ?? "",
          score: r.score,
          match_type: r.matchType ?? "keyword",
        })),
      };
    } catch {
      return { results: [] };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
