import { z } from "zod";
import {
  applyPatches,
  IsDirectoryError,
  NotFoundError,
  readContextFile,
} from "../../context/store.ts";
import { LinePatchSchema } from "../../fs/patches.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Project-relative path under context/"),
  patches: z.array(LinePatchSchema).describe("Patches to apply"),
});

const outputSchema = z.object({
  applied: z.number(),
  content: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const contextEditTool = {
  name: "context_edit",
  description:
    "[[ bash equivalent command: patch ]] Apply line-range patches to a file under context/. Each patch specifies start_line/end_line/content. Edits that traverse a user symlink fail with PathEscapeError — delete the symlink first or copy the content to a real path.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const { applied } = await applyPatches(
        ctx.projectDir,
        input.path,
        input.patches,
      );
      const content = await readContextFile(ctx.projectDir, input.path);
      return { applied, content, is_error: false };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          applied: 0,
          content: "",
          is_error: true,
          error_type: "not_found",
          message: `No file at context/${err.path}`,
        };
      }
      if (err instanceof IsDirectoryError) {
        return {
          applied: 0,
          content: "",
          is_error: true,
          error_type: "is_directory",
          message: `context/${err.path} is a directory`,
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
