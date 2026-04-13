import { z } from "zod";
import { listContextItemsByPrefix } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const DEFAULT_MAX_ITEMS = 200;

export const dirTreeTool: ToolDefinition<any, any> = {
  name: "dir_tree",
  description:
    "Render a directory as a markdown-style tree in the virtual filesystem.",
  group: "dir",
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe("Root path for the tree (defaults to /)"),
    max_items: z
      .number()
      .optional()
      .default(DEFAULT_MAX_ITEMS)
      .describe(
        `Maximum number of items to include (defaults to ${DEFAULT_MAX_ITEMS})`,
      ),
  }),
  outputSchema: z.object({
    tree: z.string(),
  }),
  execute: async (input, ctx) => {
    const path = input.path ?? "/";
    const maxItems = input.max_items ?? DEFAULT_MAX_ITEMS;
    const items = await listContextItemsByPrefix(ctx.conn, path, {
      recursive: true,
      limit: maxItems,
    });

    if (items.length === 0) {
      return { tree: `${path}\n  (empty)` };
    }

    const normalizedPath = path.endsWith("/") ? path : `${path}/`;

    // Build tree structure
    const lines: string[] = [path];

    // Collect all paths and sort
    const paths = items.map((i) => i.context_path).sort();

    // Collect all directory prefixes
    const dirSet = new Set<string>();
    for (const p of paths) {
      const relative = p.slice(normalizedPath.length);
      const parts = relative.split("/");
      for (let i = 1; i < parts.length; i++) {
        dirSet.add(parts.slice(0, i).join("/"));
      }
    }

    // Merge dirs and files, sort
    const allEntries = [
      ...Array.from(dirSet).map((d) => ({ path: d, isDir: true })),
      ...paths.map((p) => ({
        path: p.slice(normalizedPath.length),
        isDir: false,
      })),
    ].sort((a, b) => a.path.localeCompare(b.path));

    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i]!;
      const depth = entry.path.split("/").length - 1;
      const isLast =
        i === allEntries.length - 1 ||
        allEntries[i + 1]!.path.split("/").length - 1 <= depth;
      const prefix = isLast ? "└── " : "├── ";
      const indent = "│   ".repeat(depth);
      const name = entry.path.split("/").pop()!;
      const suffix = entry.isDir ? "/" : "";
      lines.push(`${indent}${prefix}${name}${suffix}`);
    }

    if (items.length >= maxItems) {
      lines.push(`... (truncated at ${maxItems} items)`);
    }

    return { tree: lines.join("\n") };
  },
};
