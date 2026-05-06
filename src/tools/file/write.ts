import { z } from "zod";
import { PathConflictError, writeContextFile } from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z
    .string()
    .describe(
      "Project-relative path under context/ (e.g. 'notes/foo.md'). Created if its parent directory does not exist.",
    ),
  content: z.string().describe("Text content to write"),
  on_conflict: z
    .enum(["error", "overwrite"])
    .optional()
    .describe(
      "What to do if the file already exists. Defaults to 'error'. Pass 'overwrite' to replace.",
    ),
});

const outputSchema = z.object({
  path: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextWriteTool = {
  name: "context_write",
  description:
    "[[ bash equivalent command: tee ]] Write text content to a file under context/. Fails if the path already exists unless on_conflict='overwrite'. Writes that traverse a user symlink fail with PathEscapeError — delete the symlink first or write to a real path.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const entry = await writeContextFile(
        ctx.projectDir,
        input.path,
        input.content,
        { onConflict: input.on_conflict ?? "error", holderId: ctx.workerId },
      );
      return { path: entry.path, is_error: false };
    } catch (err) {
      if (err instanceof PathConflictError) {
        return {
          path: err.path,
          is_error: true,
          error_type: "path_conflict",
          message: `A file already exists at context/${err.path}.`,
          next_action_hint:
            "Call context_read to inspect, or retry with on_conflict='overwrite'.",
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
