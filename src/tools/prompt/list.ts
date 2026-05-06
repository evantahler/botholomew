import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getPromptsDir } from "../../constants.ts";
import {
  PromptValidationError,
  parsePromptFile,
} from "../../utils/frontmatter.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  limit: z
    .number()
    .optional()
    .default(100)
    .describe("Max number of prompts to return (default 100)"),
  offset: z
    .number()
    .optional()
    .default(0)
    .describe("Skip the first N prompts (default 0)"),
});

const outputSchema = z.object({
  prompts: z.array(
    z.object({
      name: z.string(),
      title: z.string().nullable(),
      loading: z.string().nullable(),
      agent_modification: z.boolean(),
      size_bytes: z.number(),
      path: z.string(),
      valid: z.boolean(),
      error: z.string().nullable(),
    }),
  ),
  total: z.number(),
  is_error: z.boolean(),
});

export const promptListTool = {
  name: "prompt_list",
  description:
    "[[ bash equivalent command: ls ]] List prompt files under prompts/. Returns name, title, loading mode, agent_modification flag, file size, and a valid/error pair per file (so you can see at a glance which prompts have broken frontmatter).",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const dir = getPromptsDir(ctx.projectDir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { prompts: [], total: 0, is_error: false };
      }
      throw err;
    }

    const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
    const total = mdFiles.length;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const page = mdFiles.slice(offset, offset + limit);

    const rows = await Promise.all(
      page.map(async (filename) => {
        const filePath = join(dir, filename);
        const name = filename.replace(/\.md$/, "");
        const [raw, st] = await Promise.all([
          Bun.file(filePath).text(),
          stat(filePath),
        ]);
        try {
          const { meta } = parsePromptFile(filePath, raw);
          return {
            name,
            title: meta.title,
            loading: meta.loading,
            agent_modification: meta["agent-modification"],
            size_bytes: st.size,
            path: filePath,
            valid: true,
            error: null,
          };
        } catch (err) {
          const reason =
            err instanceof PromptValidationError
              ? err.reason
              : err instanceof Error
                ? err.message
                : String(err);
          return {
            name,
            title: null,
            loading: null,
            agent_modification: false,
            size_bytes: st.size,
            path: filePath,
            valid: false,
            error: reason,
          };
        }
      }),
    );

    return { prompts: rows, total, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
