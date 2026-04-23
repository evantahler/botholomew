import { z } from "zod";
import { resolveContextItemOrThrow } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path or context item ID"),
});

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  mime_type: z.string(),
  is_textual: z.boolean(),
  size: z.number(),
  lines: z.number(),
  source_path: z.string().nullable(),
  context_path: z.string(),
  indexed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_error: z.boolean(),
});

export const contextInfoTool = {
  name: "context_info",
  description:
    "[[ bash equivalent command: stat ]] Show context item metadata: size, MIME type, line count, etc.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const item = await resolveContextItemOrThrow(ctx.conn, input.path);

    const content = item.content ?? "";
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      mime_type: item.mime_type,
      is_textual: item.is_textual,
      size: content.length,
      lines: content ? content.split("\n").length : 0,
      source_path: item.source_path,
      context_path: item.context_path,
      indexed_at: item.indexed_at?.toISOString() ?? null,
      created_at: item.created_at.toISOString(),
      updated_at: item.updated_at.toISOString(),
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
