import { z } from "zod";
import { createContextDir, fileExists } from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Directory path to create under context/"),
});

const outputSchema = z.object({
  path: z.string(),
  created: z.boolean(),
  is_error: z.boolean(),
});

export const contextCreateDirTool = {
  name: "context_create_dir",
  description:
    "[[ bash equivalent command: mkdir -p ]] Create a directory (recursively) under context/.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const existed = await fileExists(ctx.projectDir, input.path);
    await createContextDir(ctx.projectDir, input.path);
    return { path: input.path, created: !existed, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
