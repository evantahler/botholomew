import { isText } from "istextorbinary";
import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import { ingestByPath } from "../../context/ingest.ts";
import {
  createContextItemStrict,
  PathConflictError,
  upsertContextItem,
} from "../../db/context.ts";
import { buildContextTree } from "../dir/tree.ts";
import type { ToolDefinition } from "../tool.ts";

function mimeFromPath(path: string): string {
  const type = Bun.file(path).type.split(";")[0];
  return type ?? "application/octet-stream";
}

function isTextualPath(path: string): boolean {
  const filename = path.split("/").pop() ?? path;
  const result = isText(filename);
  return result !== false;
}

const inputSchema = z.object({
  drive: z
    .string()
    .default("agent")
    .describe(
      "Drive to write to (defaults to 'agent', which is the agent's scratch drive). Only 'agent' and drives mirroring an external system you can write back to make sense here.",
    ),
  path: z.string().describe("Path within the drive (starts with /)"),
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
      "What to do if a file already exists at this (drive, path). Defaults to 'error'. Pass 'overwrite' to replace.",
    ),
});

const outputSchema = z.object({
  id: z.string().nullable(),
  drive: z.string(),
  path: z.string(),
  ref: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
  tree: z
    .string()
    .optional()
    .describe(
      "Snapshot of the drive's tree after the write so you can see the surrounding files.",
    ),
});

export const contextWriteTool = {
  name: "context_write",
  description:
    "[[ bash equivalent command: tee ]] Write content to a context item. By default writes to drive='agent' (the agent's scratch drive). Fails if the (drive, path) already exists — pass on_conflict='overwrite' to replace.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const mimeType = mimeFromPath(input.path);
    const isTextual = isTextualPath(input.path);
    const title =
      input.title ?? input.path.split("/").filter(Boolean).pop() ?? input.path;
    const onConflict = input.on_conflict ?? "error";
    const target = { drive: input.drive, path: input.path };

    try {
      const item =
        onConflict === "overwrite"
          ? await upsertContextItem(ctx.conn, {
              title,
              description: input.description,
              content: input.content_base64 ?? input.content,
              drive: target.drive,
              path: target.path,
              mimeType,
              isTextual,
            })
          : await createContextItemStrict(ctx.conn, {
              title,
              description: input.description,
              content: input.content_base64 ?? input.content,
              drive: target.drive,
              path: target.path,
              mimeType,
              isTextual,
            });

      await ingestByPath(ctx.conn, target, ctx.config);
      const { tree } = await buildContextTree(ctx.conn, {
        drive: target.drive,
      });
      return {
        id: item.id,
        drive: item.drive,
        path: item.path,
        ref: formatDriveRef(item),
        is_error: false,
        tree,
      };
    } catch (err) {
      if (err instanceof PathConflictError) {
        return {
          id: null,
          drive: err.drive,
          path: err.path,
          ref: formatDriveRef({ drive: err.drive, path: err.path }),
          is_error: true,
          error_type: "path_conflict",
          message: `A file already exists at ${formatDriveRef({ drive: err.drive, path: err.path })} (id: ${err.existingId}).`,
          next_action_hint:
            "Call context_read to inspect the existing file, or retry with on_conflict='overwrite' to replace it.",
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
