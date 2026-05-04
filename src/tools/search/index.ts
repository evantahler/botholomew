import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";
import { fuseRRF } from "./fuse.ts";
import { runRegexp } from "./regexp.ts";
import { runSemantic } from "./semantic.ts";

const MatchSchema = z.object({
  path: z.string(),
  line: z.number().nullable(),
  content: z.string(),
  context_lines: z.array(z.string()),
  match_type: z.enum(["regexp", "semantic", "both"]),
  semantic_score: z.number().nullable(),
  score: z.number(),
});

const inputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Natural-language query for semantic search. Provide alongside `pattern` for the strongest signal — files matched by both methods float to the top via reciprocal rank fusion.",
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      "Regex pattern for exact text search across file contents under context/.",
    ),
  scope: z
    .string()
    .optional()
    .describe(
      "Restrict search to a sub-directory under context/ (e.g. 'notes' to only search context/notes/...).",
    ),
  glob: z
    .string()
    .optional()
    .describe("Filter results to files whose basename matches this glob."),
  ignore_case: z
    .boolean()
    .optional()
    .describe("Case-insensitive regex (only affects `pattern`)."),
  context: z
    .number()
    .optional()
    .describe(
      "Lines of surrounding context to include for each regex hit (only affects `pattern`).",
    ),
  max_results: z
    .number()
    .optional()
    .describe("Maximum number of fused results to return (default 20)."),
});

const outputSchema = z.object({
  matches: z.array(MatchSchema),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const searchTool = {
  name: "search",
  description:
    "[[ bash equivalent command: grep -r ]] Hybrid search over files under context/. At least one of `query` (natural language → semantic) or `pattern` (regex over file contents) is required. Pass both for the strongest signal: results matched by both methods float to the top via reciprocal rank fusion. Scoping (`scope`, `glob`) applies to both sides. Note: while a persistent index sidecar is being rebuilt, semantic search re-embeds files on every call — keep result sets small.",
  group: "search",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!input.query && !input.pattern) {
      return {
        matches: [],
        is_error: true,
        error_type: "invalid_arguments",
        message:
          "Provide at least one of `query` (natural language) or `pattern` (regex). Pass both to fuse semantic and exact-match signals.",
      };
    }

    const limit = input.max_results ?? 20;

    const regexpHits = input.pattern
      ? await runRegexp(ctx.projectDir, {
          pattern: input.pattern,
          scope: input.scope,
          glob: input.glob,
          ignore_case: input.ignore_case,
          context: input.context,
          max_results: 100,
        })
      : [];

    const semanticHits = input.query
      ? await runSemantic(ctx.projectDir, ctx.config, {
          query: input.query,
          scope: input.scope,
          glob: input.glob,
          limit: 100,
        })
      : [];

    const matches = fuseRRF(regexpHits, semanticHits, { limit });

    return { matches, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
