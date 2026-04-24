import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import { contextPathExists, createContextItem } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  drive: z
    .string()
    .default("agent")
    .describe("Drive to create the directory in (defaults to 'agent')"),
  path: z.string().describe("Directory path to create (starts with /)"),
});

const outputSchema = z.object({
  created: z.boolean(),
  ref: z.string(),
  is_error: z.boolean(),
});

export const contextCreateDirTool = {
  name: "context_create_dir",
  description:
    "[[ bash equivalent command: mkdir -p ]] Create a directory placeholder in context.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const target = { drive: input.drive, path: input.path };
    const exists = await contextPathExists(ctx.conn, target);
    if (exists) {
      return { created: false, ref: formatDriveRef(target), is_error: false };
    }

    await createContextItem(ctx.conn, {
      title: input.path.split("/").filter(Boolean).pop() ?? input.path,
      drive: target.drive,
      path: target.path,
      mimeType: "inode/directory",
      isTextual: false,
    });

    return { created: true, ref: formatDriveRef(target), is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
