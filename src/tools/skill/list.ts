import { basename } from "node:path";
import { z } from "zod";
import { loadSkills } from "../../skills/loader.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  limit: z
    .number()
    .optional()
    .default(100)
    .describe("Max number of skills to return (default 100)"),
  offset: z
    .number()
    .optional()
    .default(0)
    .describe("Skip the first N skills (default 0)"),
});

const outputSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      arguments: z.array(z.string()),
      filename: z.string(),
      path: z.string(),
    }),
  ),
  total: z.number(),
  is_error: z.boolean(),
});

export const skillListTool = {
  name: "skill_list",
  description:
    "[[ bash equivalent command: ls ]] List skills (user-defined slash commands) loaded from skills/. Returns name, description, argument names, and file path for each.",
  group: "skill",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const skills = await loadSkills(ctx.projectDir);
    const sorted = [...skills.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const total = sorted.length;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const page = sorted.slice(offset, offset + limit);

    return {
      skills: page.map((s) => ({
        name: s.name,
        description: s.description,
        arguments: s.arguments.map((a) => a.name),
        filename: basename(s.filePath),
        path: s.filePath,
      })),
      total,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
