import { z } from "zod";
import {
  deleteContextPath,
  IsDirectoryError,
  NotFoundError,
} from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Path under context/ to delete"),
  recursive: z
    .boolean()
    .optional()
    .describe("Delete a directory and its contents recursively"),
  force: z
    .boolean()
    .optional()
    .describe("Do not error if the path does not exist"),
});

const outputSchema = z.object({
  deleted: z.number(),
  was_directory: z.boolean(),
  was_symlink: z.boolean(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextDeleteTool = {
  name: "context_delete",
  description:
    "[[ bash equivalent command: rm -r ]] Delete a file or (with recursive=true) a directory under context/. Symlinks are unlinked without touching their target — `recursive` is not required for a symlinked directory.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const result = await deleteContextPath(ctx.projectDir, input.path, {
        recursive: input.recursive,
      });
      return {
        deleted: result.removed,
        was_directory: result.was_directory,
        was_symlink: result.was_symlink,
        is_error: false,
      };
    } catch (err) {
      if (err instanceof NotFoundError) {
        if (input.force) {
          return {
            deleted: 0,
            was_directory: false,
            was_symlink: false,
            is_error: false,
          };
        }
        return {
          deleted: 0,
          was_directory: false,
          was_symlink: false,
          is_error: true,
          error_type: "not_found",
          message: `No file at context/${err.path}`,
        };
      }
      if (err instanceof IsDirectoryError) {
        return {
          deleted: 0,
          was_directory: true,
          was_symlink: false,
          is_error: true,
          error_type: "is_directory",
          message: `context/${err.path} is a directory`,
          next_action_hint: "Pass recursive=true to delete a directory tree.",
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
