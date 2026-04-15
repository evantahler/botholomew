import { z } from "zod";
import { embedSingle } from "../../context/embedder.ts";
import { hybridSearch, initVectorSearch } from "../../db/embeddings.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  query: z.string().describe("Natural language search query"),
  top_k: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum number of results to return (defaults to 10)"),
  threshold: z
    .number()
    .optional()
    .describe("Minimum similarity score (0-1) to include in results"),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      score: z.number(),
      snippet: z.string(),
    }),
  ),
  is_error: z.boolean(),
});

export const searchSemanticTool = {
  name: "search_semantic",
  description:
    "Semantic search over indexed files using vector embeddings. Finds conceptually related content, not just keyword matches.",
  group: "search",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    initVectorSearch(ctx.conn);

    const queryVec = await embedSingle(input.query);
    const results = hybridSearch(ctx.conn, input.query, queryVec, input.top_k);

    const threshold = input.threshold;
    const filtered =
      threshold !== undefined
        ? results.filter((r) => r.score >= threshold)
        : results;

    return {
      results: filtered
        .map((r) => ({
          path: r.source_path || r.context_item_id,
          title: r.title,
          score: Math.round(r.score * 1000) / 1000,
          snippet: (r.chunk_content || "").slice(0, 300),
        }))
        .sort((a, b) => b.score - a.score),
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
