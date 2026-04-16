import { isText } from "istextorbinary";
import { z } from "zod";
import { ingestByPath } from "../../context/ingest.ts";
import { upsertContextItem } from "../../db/context.ts";
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
    const title =
      input.title ?? input.path.split("/").filter(Boolean).pop() ?? input.path;

    const item = await upsertContextItem(ctx.conn, {
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
