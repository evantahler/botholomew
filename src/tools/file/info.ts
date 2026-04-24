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
    .describe(
      "Drive name (e.g. 'disk', 'url', 'agent'). Ignored when `path` is a UUID or already in `drive:/...` form.",
    ),
  path: z
    .string()
    .describe(
      "Path within the drive (starts with /), or a bare UUID / 'drive:/path' ref.",
    ),
});

const fileSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  mime_type: z.string(),
  is_textual: z.boolean(),
  size: z.number(),
  lines: z.number(),
  drive: z.string(),
  path: z.string(),
  ref: z.string(),
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
        drive: item.drive,
        path: item.path,
        ref: formatDriveRef(item),
        indexed_at: item.indexed_at?.toISOString() ?? null,
        created_at: item.created_at.toISOString(),
        updated_at: item.updated_at.toISOString(),
      },
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
