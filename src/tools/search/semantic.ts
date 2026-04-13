import { z } from "zod";
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
});

export const searchSemanticTool = {
  name: "search_semantic",
  description:
    "Semantic search over indexed files using vector embeddings. Finds conceptually related content, not just keyword matches.",
  group: "search",
  inputSchema,
  outputSchema,
  execute: async () => {
    throw new Error(
      "Semantic search is not yet available — requires the embeddings pipeline (M2)",
    );
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
