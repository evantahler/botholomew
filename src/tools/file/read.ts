import { z } from "zod";
import {
  findNearbyContextPaths,
  resolveContextItem,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path or context item ID"),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Maximum number of lines to return"),
});

const outputSchema = z.object({
  content: z.string().optional(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextReadTool = {
  name: "context_read",
  description:
    "[[ bash equivalent command: cat ]] Read a context item's contents.",
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

    if (item.content == null) {
      return {
        is_error: true,
        error_type: "no_text_content",
        message: `Context item ${item.context_path} has no text content (mime: ${item.mime_type})`,
        next_action_hint:
          "Binary items can't be read as text. Call context_info to inspect metadata, or pick a textual sibling.",
      };
    }

    let content = item.content;

    if (input.offset || input.limit) {
      const lines = content.split("\n");
      const start = (input.offset ?? 1) - 1;
      const end = input.limit ? start + input.limit : lines.length;
      content = lines.slice(start, end).join("\n");
    }

    return { content, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
