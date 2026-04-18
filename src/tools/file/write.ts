import { isText } from "istextorbinary";
import { z } from "zod";
import { ingestByPath } from "../../context/ingest.ts";
import {
  createContextItemStrict,
  PathConflictError,
  upsertContextItem,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

function mimeFromPath(path: string): string {
  const type = Bun.file(path).type.split(";")[0];
  return type ?? "application/octet-stream";
}

function isTextualPath(path: string): boolean {
  const filename = path.split("/").pop() ?? path;
  const result = isText(filename);
  // isText returns null if it can't determine from filename alone — default to true
  return result !== false;
}

const inputSchema = z.object({
  path: z.string().describe("File path to write"),
  content: z.string().describe("Text content to write"),
  content_base64: z
    .string()
    .optional()
    .describe(
      "Base64-encoded binary content (used instead of content for binary files)",
    ),
  title: z
    .string()
    .optional()
    .describe("Title for the file (defaults to filename)"),
  description: z.string().optional().describe("Description of the file"),
  on_conflict: z
    .enum(["error", "overwrite"])
    .optional()
    .describe(
      "What to do if a file already exists at this path. Defaults to 'error'. Pass 'overwrite' to replace.",
    ),
});

const outputSchema = z.object({
  id: z.string().nullable(),
  path: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextWriteTool = {
  name: "context_write",
  description:
    "Write content to a context item. By default, fails if the path already exists — pass on_conflict='overwrite' to replace.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const mimeType = mimeFromPath(input.path);
    const isTextual = isTextualPath(input.path);
    const title =
      input.title ?? input.path.split("/").filter(Boolean).pop() ?? input.path;
    const onConflict = input.on_conflict ?? "error";

    try {
      const item =
        onConflict === "overwrite"
          ? await upsertContextItem(ctx.conn, {
              title,
              description: input.description,
              content: input.content_base64 ?? input.content,
              contextPath: input.path,
              mimeType,
              isTextual,
            })
          : await createContextItemStrict(ctx.conn, {
              title,
              description: input.description,
              content: input.content_base64 ?? input.content,
              contextPath: input.path,
              mimeType,
              isTextual,
            });

      await ingestByPath(ctx.conn, input.path, ctx.config);
      return { id: item.id, path: item.context_path, is_error: false };
    } catch (err) {
      if (err instanceof PathConflictError) {
        return {
          id: null,
          path: input.path,
          is_error: true,
          error_type: "path_conflict",
          message: `A file already exists at ${input.path} (id: ${err.existingId}).`,
          next_action_hint:
            "Call context_read to inspect the existing file, or retry with on_conflict='overwrite' to replace it.",
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
