import { z } from "zod";
import {
  listContextItems,
  listContextItemsByPrefix,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";
import { fuseRRF } from "./fuse.ts";
import { runRegexp } from "./regexp.ts";
import { runSemantic } from "./semantic.ts";

const MatchSchema = z.object({
  ref: z.string(),
  drive: z.string(),
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
      "Natural-language query for semantic + keyword (BM25) hybrid search. Provide alongside `pattern` for the strongest signal — chunks matched by both methods are boosted via reciprocal rank fusion.",
    ),
  pattern: z
    .string()
    .optional()
    .describe("Regex pattern for exact text search across context contents."),
  drive: z
    .string()
    .optional()
    .describe(
      "Restrict to a single drive (applies to both `query` and `pattern`).",
    ),
  path: z
    .string()
    .optional()
    .describe("Directory prefix within the drive. Requires `drive`."),
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
    "[[ bash equivalent command: grep -r ]] Hybrid search over indexed context. At least one of `query` (natural language → semantic + BM25) or `pattern` (regex over file contents) is required. Pass both for the strongest signal: results matched by both methods float to the top via reciprocal rank fusion. Scoping (`drive`, `path`, `glob`) applies to both sides.",
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
    if (input.path && !input.drive) {
      return {
        matches: [],
        is_error: true,
        error_type: "invalid_arguments",
        message:
          "`path` requires `drive` — call context_list_drives to see which drives exist, then pass `drive` alongside `path`.",
      };
    }

    const limit = input.max_results ?? 20;

    const regexpHits = input.pattern
      ? runRegexp(
          input.drive
            ? await listContextItemsByPrefix(
                ctx.conn,
                input.drive,
                input.path ?? "/",
                { recursive: true },
              )
            : await listContextItems(ctx.conn),
          {
            pattern: input.pattern,
            glob: input.glob,
            ignore_case: input.ignore_case,
            context: input.context,
            max_results: 100,
          },
        )
      : [];

    const semanticHits = input.query
      ? await runSemantic(ctx, {
          query: input.query,
          drive: input.drive,
          path: input.path,
          glob: input.glob,
          limit: 100,
        })
      : [];

    const matches = fuseRRF(regexpHits, semanticHits, { limit });

    return { matches, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
