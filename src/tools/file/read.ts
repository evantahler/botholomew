import { z } from "zod";
import { formatDriveRef, parseDriveRef } from "../../context/drives.ts";
import {
  findNearbyContextPaths,
  getContextItem,
  getContextItemById,
} from "../../db/context.ts";
import { isUuid } from "../../db/uuid.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  drive: z
    .string()
    .optional()
    .describe(
      "Drive name (e.g. 'disk', 'url', 'agent', 'google-docs', 'github'). Use context_list_drives to see what's available. Optional when `path` is a UUID or already in `drive:/...` form.",
    ),
  path: z
    .string()
    .describe(
      "Path within the drive (starts with /), or a bare UUID / 'drive:/path' ref (in which case `drive` is ignored).",
    ),
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
    // Accept either (drive, path) or a bare UUID / drive:/path ref in `path`.
    let drive = input.drive;
    let path = input.path;
    if (isUuid(input.path)) {
      const byId = await getContextItemById(ctx.conn, input.path);
      if (byId) {
        drive = byId.drive;
        path = byId.path;
      }
    } else {
      const parsed = parseDriveRef(input.path);
      if (parsed) {
        drive = parsed.drive;
        path = parsed.path;
      }
    }

    if (!drive) {
      return {
        is_error: true,
        error_type: "missing_drive",
        message: `Cannot resolve context item: no drive provided and \`${input.path}\` is not a UUID or \`drive:/path\` ref.`,
        next_action_hint:
          "Pass `drive` explicitly, or use a `drive:/path` ref. Call context_list_drives to see which drives exist.",
      };
    }

    if (!path.startsWith("/")) path = `/${path}`;

    const item = await getContextItem(ctx.conn, { drive, path });
    if (!item) {
      const { parent, siblings, walkedUp } = await findNearbyContextPaths(
        ctx.conn,
        drive,
        path,
      );
      const hint =
        siblings.length > 0
          ? `${walkedUp ? `Parent ${parent} has no direct entries; ` : ""}Nearby items under ${parent}: ${siblings.join(", ")}. Call context_tree({drive:"${drive}",path:"${parent.replace(/^[^:]*:/, "")}"}) to see more.`
          : `No items found under ${parent}. Call context_list_drives to see which drives exist.`;
      return {
        is_error: true,
        error_type: "not_found",
        message: `No context item at ${formatDriveRef({ drive, path })}`,
        next_action_hint: hint,
      };
    }

    if (item.content == null) {
      return {
        is_error: true,
        error_type: "no_text_content",
        message: `Context item ${formatDriveRef(item)} has no text content (mime: ${item.mime_type})`,
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
