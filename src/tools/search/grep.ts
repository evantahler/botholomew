import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";
import { listContextItemsByPrefix } from "../../db/context.ts";

const GrepMatchSchema = z.object({
  path: z.string(),
  line: z.number(),
  content: z.string(),
  context_lines: z.array(z.string()),
});

export const searchGrepTool: ToolDefinition<any, any> = {
  name: "search_grep",
  description:
    "Search file contents by regex pattern in the virtual filesystem.",
  group: "search",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in (defaults to /)"),
    glob: z
      .string()
      .optional()
      .describe("Only search files matching this glob pattern"),
    ignore_case: z.boolean().optional().describe("Case-insensitive search"),
    context: z
      .number()
      .optional()
      .describe("Number of context lines before and after each match"),
    max_results: z
      .number()
      .optional()
      .describe("Maximum number of matches to return"),
  }),
  outputSchema: z.object({
    matches: z.array(GrepMatchSchema),
  }),
  execute: async (input, ctx) => {
    const searchPath = input.path ?? "/";
    const items = await listContextItemsByPrefix(ctx.conn, searchPath, {
      recursive: true,
    });

    const flags = input.ignore_case ? "gi" : "g";
    const regex = new RegExp(input.pattern, flags);
    const globRegex = input.glob ? globToRegex(input.glob) : null;
    const contextLines = input.context ?? 0;
    const maxResults = input.max_results ?? 100;

    const matches: z.infer<typeof GrepMatchSchema>[] = [];

    for (const item of items) {
      if (item.content == null) continue;

      if (globRegex) {
        const filename = item.context_path.split("/").pop() ?? "";
        if (!globRegex.test(filename)) continue;
      }

      const lines = item.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i]!)) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length, i + contextLines + 1);
          matches.push({
            path: item.context_path,
            line: i + 1,
            content: lines[i]!,
            context_lines: lines.slice(start, end),
          });
          if (matches.length >= maxResults) return { matches };
        }
      }
    }

    return { matches };
  },
};

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
