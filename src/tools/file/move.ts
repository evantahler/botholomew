import { z } from "zod";
import {
  deleteContextPath,
  fileExists,
  moveContextPath,
  NotFoundError,
  PathConflictError,
} from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  src: z.string().describe("Source path under context/"),
  dst: z.string().describe("Destination path under context/"),
  overwrite: z.boolean().optional().describe("Overwrite if destination exists"),
});

const outputSchema = z.object({
  src: z.string(),
  dst: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const contextMoveTool = {
  name: "context_move",
  description:
    "[[ bash equivalent command: mv ]] Move or rename a file/directory under context/.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      if (input.overwrite && (await fileExists(ctx.projectDir, input.dst))) {
        await deleteContextPath(ctx.projectDir, input.dst, { recursive: true });
      }
      await moveContextPath(ctx.projectDir, input.src, input.dst);
      return { src: input.src, dst: input.dst, is_error: false };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          src: input.src,
          dst: input.dst,
          is_error: true,
          error_type: "not_found",
          message: `No file at context/${err.path}`,
        };
      }
      if (err instanceof PathConflictError) {
        return {
          src: input.src,
          dst: input.dst,
          is_error: true,
          error_type: "path_conflict",
          message: `Destination already exists at context/${err.path}; pass overwrite=true to replace.`,
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
