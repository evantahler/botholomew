import { z } from "zod";
import { fakeMcpSearch, isCaptureMode } from "../../daemon/fake-mcp.ts";
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
  is_error: z.boolean(),
  error_message: z.string().optional(),
  hint: z.string().optional(),
});

export const mcpSearchTool = {
  name: "mcp_search",
  description:
    "Search for MCP tools by keyword, semantic similarity, or both. By default uses hybrid search (keyword + semantic). Set keyword_only=true for exact term matching or semantic_only=true for meaning-based similarity. Requires a pre-built search index (run `botholomew mcpx index`).",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (isCaptureMode()) {
      const canned = fakeMcpSearch(input.query);
      if (canned) {
        return {
          results: canned,
          is_error: false,
          hint: "Use mcp_info with server and tool name to see the full input schema before calling mcp_exec.",
        };
      }
    }
    if (!ctx.mcpxClient) {
      return {
        results: [],
        is_error: false,
        hint: "No MCP servers configured. Add servers with `botholomew mcpx add`.",
      };
    }

    try {
      const results = await ctx.mcpxClient.search(input.query, {
        keywordOnly: input.keyword_only,
        semanticOnly: input.semantic_only,
      });
      const mapped = results.map((r) => ({
        server: r.server,
        tool: r.tool,
        description: r.description ?? "",
        score: r.score,
        match_type: r.matchType ?? "keyword",
      }));
      return {
        results: mapped,
        is_error: false,
        hint:
          mapped.length > 0
            ? "Use mcp_info with server and tool name to see the full input schema before calling mcp_exec."
            : "No matches. Try broader search terms, or use mcp_list_tools to browse all available tools.",
      };
    } catch (err) {
      const msg = String(err).toLowerCase();
      const isIndexMissing =
        msg.includes("index") ||
        msg.includes("not found") ||
        msg.includes("no such file");

      return {
        results: [],
        is_error: true,
        error_message: isIndexMissing
          ? "Search index not built. Run 'botholomew mcpx index' to build it."
          : `Search failed: ${err}`,
        hint: isIndexMissing
          ? "Use mcp_list_tools to browse available tools instead."
          : "Search temporarily unavailable. Use mcp_list_tools as a fallback.",
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
