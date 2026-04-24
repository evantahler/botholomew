import { z } from "zod";
import {
  findNearbyContextPaths,
  resolveContextItem,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path or context item ID"),
});

const fileSchema = z.object({
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
});

const outputSchema = z.object({
  file: fileSchema.optional(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextInfoTool = {
  name: "context_info",
  description:
    "[[ bash equivalent command: stat ]] Show context item metadata: size, MIME type, line count, etc.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const item = await resolveContextItem(ctx.conn, input.path);
    if (!item) {
      const { parent, siblings, walkedUp } = await findNearbyContextPaths(
        ctx.conn,
        input.path,
      );
      const hint =
        siblings.length > 0
          ? `${walkedUp ? `Parent ${parent} has no direct entries; ` : ""}Nearby paths under ${parent}: ${siblings.join(", ")}. Call context_tree({path:"${parent}"}) to see more.`
          : `No items found under ${parent}. Call context_tree({path:"/"}) to discover what exists.`;
      return {
        is_error: true,
        error_type: "not_found",
        message: `No context item at ${input.path}`,
        next_action_hint: hint,
      };
    }

    const content = item.content ?? "";
    return {
      file: {
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
      },
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
