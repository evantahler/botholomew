import { isText } from "istextorbinary";
import { z } from "zod";
import { ingestByPath } from "../../context/ingest.ts";
import {
  createContextItem,
  getContextItemByPath,
  updateContextItem,
  updateContextItemContent,
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
});

const outputSchema = z.object({
  id: z.string(),
  path: z.string(),
  is_error: z.boolean(),
});

export const fileWriteTool = {
  name: "file_write",
  description:
    "Write content to a file in the virtual filesystem. Creates the file if it doesn't exist, or overwrites if it does.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const mimeType = mimeFromPath(input.path);
    const isTextual = isTextualPath(input.path);
    const existing = await getContextItemByPath(ctx.conn, input.path);

    if (existing) {
      if (input.content_base64) {
        // Binary update — store as content for now (DB blob support can be added later)
        await updateContextItemContent(
          ctx.conn,
          input.path,
          input.content_base64,
        );
      } else {
        await updateContextItemContent(ctx.conn, input.path, input.content);
      }
      if (input.title || input.description) {
        await updateContextItem(ctx.conn, existing.id, {
          title: input.title,
          description: input.description,
        });
      }
      await ingestByPath(ctx.conn, input.path, ctx.config);
      return { id: existing.id, path: input.path, is_error: false };
    }

    const title =
      input.title ?? input.path.split("/").filter(Boolean).pop() ?? input.path;

    const item = await createContextItem(ctx.conn, {
      title,
      description: input.description,
      content: input.content_base64 ?? input.content,
      contextPath: input.path,
      mimeType,
      isTextual,
    });

    await ingestByPath(ctx.conn, input.path, ctx.config);
    return { id: item.id, path: item.context_path, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
