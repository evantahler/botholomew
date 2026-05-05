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
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextCreateDirTool = {
  name: "context_create_dir",
  description:
    "[[ bash equivalent command: mkdir -p ]] Create a directory (recursively) under context/. Paths that traverse a user symlink fail with PathEscapeError.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const existed = await fileExists(ctx.projectDir, input.path);
      await createContextDir(ctx.projectDir, input.path);
      return { path: input.path, created: !existed, is_error: false };
    } catch (err) {
      // mkdir surfaces ENOTDIR when a path component is a file, EACCES on
      // permission issues, etc. Convert to a structured error so the agent
      // can pick a different parent or read what's actually there first.
      const code = (err as NodeJS.ErrnoException).code;
      const message = err instanceof Error ? err.message : String(err);
      return {
        path: input.path,
        created: false,
        is_error: true,
        error_type: code === "ENOTDIR" ? "not_a_directory" : "create_failed",
        message,
        next_action_hint:
          "Run context_tree on the parent path to see what's there before retrying.",
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
