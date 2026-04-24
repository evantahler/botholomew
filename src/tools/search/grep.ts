import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import {
  listContextItems,
  listContextItemsByPrefix,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const GrepMatchSchema = z.object({
  ref: z.string(),
  drive: z.string(),
  path: z.string(),
  line: z.number(),
  content: z.string(),
  context_lines: z.array(z.string()),
});

const inputSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  drive: z
    .string()
    .optional()
    .describe("Restrict search to a single drive (defaults to all drives)"),
  path: z
    .string()
    .optional()
    .describe(
      "Directory to search under within the drive (defaults to /). Requires `drive`.",
    ),
  glob: z
    .string()
    .optional()
    .describe("Only search files whose basename matches this glob pattern"),
  ignore_case: z.boolean().optional().describe("Case-insensitive search"),
  context: z
    .number()
    .optional()
    .describe("Number of context lines before and after each match"),
  max_results: z
    .number()
    .optional()
    .describe("Maximum number of matches to return"),
});

const outputSchema = z.object({
  matches: z.array(GrepMatchSchema),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const searchGrepTool = {
  name: "search_grep",
  description: "Search file contents by regex pattern across context drives.",
  group: "search",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    // `path` scopes to a directory within a single drive; requiring `drive`
    // alongside prevents a silent full-DB scan when only `path` is passed.
    if (input.path && !input.drive) {
      return {
        matches: [],
        is_error: true,
        error_type: "invalid_arguments",
        message:
          "`path` requires `drive` — use context_list_drives to see which drives exist, then pass `drive` alongside `path`.",
      };
    }

    const items = input.drive
      ? await listContextItemsByPrefix(
          ctx.conn,
          input.drive,
          input.path ?? "/",
          {
            recursive: true,
          },
        )
      : await listContextItems(ctx.conn);

    const flags = input.ignore_case ? "gi" : "g";
    const regex = new RegExp(input.pattern, flags);
    const globRegex = input.glob ? globToRegex(input.glob) : null;
    const contextLines = input.context ?? 0;
    const maxResults = input.max_results ?? 100;

    const matches: z.infer<typeof GrepMatchSchema>[] = [];

    for (const item of items) {
      if (item.content == null) continue;

      if (globRegex) {
        const filename = item.path.split("/").pop() ?? "";
        if (!globRegex.test(filename)) continue;
      }

      const lines = item.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        const line = lines[i];
        if (line !== undefined && regex.test(line)) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length, i + contextLines + 1);
          matches.push({
            ref: formatDriveRef(item),
            drive: item.drive,
            path: item.path,
            line: i + 1,
            content: line,
            context_lines: lines.slice(start, end),
          });
          if (matches.length >= maxResults) return { matches, is_error: false };
        }
      }
    }

    return { matches, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
