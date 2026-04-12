import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";
import {
  listContextItemsByPrefix,
  getDistinctDirectories,
} from "../../db/context.ts";

const DirEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["file", "directory"]),
  size: z.number(),
});

export const dirListTool: ToolDefinition<any, any> = {
  name: "dir_list",
  description: "List directory contents in the virtual filesystem.",
  group: "dir",
  inputSchema: z.object({
    path: z.string().optional().describe("Directory path (defaults to /)"),
    recursive: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include contents of subdirectories (defaults to true)"),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe("Maximum number of entries to return (defaults to 100)"),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe("Number of entries to skip (defaults to 0)"),
  }),
  outputSchema: z.object({
    entries: z.array(DirEntrySchema),
    total: z.number(),
  }),
  execute: async (input, ctx) => {
    const path = input.path ?? "/";
    const recursive = input.recursive ?? true;
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    const normalizedPath = path.endsWith("/") ? path : `${path}/`;

    const allItems = await listContextItemsByPrefix(ctx.conn, path, {
      recursive,
    });

    const entries: z.infer<typeof DirEntrySchema>[] = allItems.map((item) => ({
      name: recursive
        ? item.context_path
        : item.context_path.slice(normalizedPath.length),
      type:
        item.mime_type === "inode/directory"
          ? ("directory" as const)
          : ("file" as const),
      size: item.content?.length ?? 0,
    }));

    // Add subdirectories (if not recursive, show immediate child dirs)
    if (!recursive) {
      const dirs = await getDistinctDirectories(ctx.conn, path);
      for (const dir of dirs) {
        const name = dir.slice(normalizedPath.length);
        if (!entries.some((e) => e.name === name)) {
          entries.push({ name, type: "directory", size: 0 });
        }
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const total = entries.length;
    const paginated = entries.slice(offset, offset + limit);

    return { entries: paginated, total };
  },
};
