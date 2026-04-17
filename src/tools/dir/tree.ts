import { z } from "zod";
import {
  countContextItemsByPrefix,
  listContextItemsByPrefix,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_ITEMS_PER_DIR = 15;
const HARD_FETCH_CAP = 1000;

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Root path for the tree (defaults to /)"),
  max_depth: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_MAX_DEPTH)
    .describe(
      `Maximum depth of directories to render (defaults to ${DEFAULT_MAX_DEPTH}). Use a deeper path to drill in.`,
    ),
  items_per_dir: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_ITEMS_PER_DIR)
    .describe(
      `Maximum entries shown per directory (defaults to ${DEFAULT_ITEMS_PER_DIR}). Overflow shown as "(+N more)".`,
    ),
});

const TruncatedDirSchema = z.object({
  path: z.string(),
  shown: z.number(),
  total: z.number(),
});

const outputSchema = z.object({
  tree: z.string(),
  is_error: z.boolean(),
  total_items: z.number(),
  truncated_dirs: z.array(TruncatedDirSchema),
  hint: z.string(),
});

interface DirNode {
  name: string;
  fullPath: string;
  isDir: true;
  children: TreeEntry[];
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: false;
}

type TreeEntry = DirNode | FileNode;

export const contextTreeTool = {
  name: "context_tree",
  description:
    "Explore your context filesystem with a bird's-eye view — shows many paths across nested directories in one call. Reach for this first when you need to discover what content exists before reading a specific file (context_read) or running a keyword search (context_search). Returns a markdown-style tree; tune max_depth and items_per_dir to bound output, or pass a deeper path to drill into a subtree.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const path = input.path ?? "/";
    const maxDepth = input.max_depth ?? DEFAULT_MAX_DEPTH;
    const itemsPerDir = input.items_per_dir ?? DEFAULT_ITEMS_PER_DIR;
    const normalizedPath = path.endsWith("/") ? path : `${path}/`;

    const totalItems = await countContextItemsByPrefix(ctx.conn, path, {
      recursive: true,
    });

    if (totalItems === 0) {
      return {
        tree: `${path}\n  (empty)`,
        is_error: false,
        total_items: 0,
        truncated_dirs: [],
        hint: "Directory is empty.",
      };
    }

    const items = await listContextItemsByPrefix(ctx.conn, path, {
      recursive: true,
      limit: HARD_FETCH_CAP,
    });

    // Build tree structure: dirs map child name -> child node
    const root: DirNode = {
      name: path,
      fullPath: path,
      isDir: true,
      children: [],
    };
    const dirIndex = new Map<string, DirNode>();
    dirIndex.set(stripTrailingSlash(path), root);

    for (const item of items) {
      const relative = item.context_path.slice(normalizedPath.length);
      if (relative.length === 0) continue; // root itself, skip
      const parts = relative.split("/").filter((p) => p.length > 0);
      const isExplicitDir = item.mime_type === "inode/directory";

      // Walk segments, creating intermediate directories as needed
      let parentDir = root;
      let currentRel = "";
      for (let i = 0; i < parts.length; i++) {
        const segment = parts[i];
        if (!segment) continue;
        currentRel = currentRel ? `${currentRel}/${segment}` : segment;
        const fullPath = `${normalizedPath}${currentRel}`;
        const isLeaf = i === parts.length - 1;
        const isDirHere = !isLeaf || isExplicitDir;

        if (isDirHere) {
          const key = stripTrailingSlash(fullPath);
          let dir = dirIndex.get(key);
          if (!dir) {
            dir = {
              name: segment,
              fullPath,
              isDir: true,
              children: [],
            };
            dirIndex.set(key, dir);
            parentDir.children.push(dir);
          }
          parentDir = dir;
        } else {
          parentDir.children.push({
            name: segment,
            fullPath,
            isDir: false,
          });
        }
      }
    }

    // Sort each directory's children: dirs first, then alphabetical
    for (const dir of dirIndex.values()) {
      dir.children.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }

    const truncatedDirs: Array<{
      path: string;
      shown: number;
      total: number;
    }> = [];
    const depthLimitedDirs: string[] = [];

    const lines: string[] = [path];

    const render = (
      dir: DirNode,
      indent: string,
      currentDepth: number,
    ): void => {
      const children = dir.children;
      const total = children.length;
      const shown = Math.min(total, itemsPerDir);
      const visible = children.slice(0, shown);
      const overflow = total - shown;

      if (overflow > 0) {
        truncatedDirs.push({
          path: stripTrailingSlash(dir.fullPath),
          shown,
          total,
        });
      }

      for (let i = 0; i < visible.length; i++) {
        const child = visible[i];
        if (!child) continue;
        const isLastVisible = i === visible.length - 1 && overflow === 0;
        const connector = isLastVisible ? "└── " : "├── ";
        const childIndent = isLastVisible ? "    " : "│   ";

        if (child.isDir) {
          const atDepthLimit = currentDepth + 1 >= maxDepth;
          if (atDepthLimit && child.children.length > 0) {
            depthLimitedDirs.push(stripTrailingSlash(child.fullPath));
            const subCount = countDescendants(child);
            lines.push(
              `${indent}${connector}${child.name}/ (${subCount} ${
                subCount === 1 ? "item" : "items"
              }, drill in)`,
            );
          } else {
            lines.push(`${indent}${connector}${child.name}/`);
            render(child, indent + childIndent, currentDepth + 1);
          }
        } else {
          lines.push(`${indent}${connector}${child.name}`);
        }
      }

      if (overflow > 0) {
        lines.push(`${indent}└── ... (+${overflow} more)`);
      }
    };

    render(root, "", 0);

    const hint = buildHint({
      truncatedDirs,
      depthLimitedDirs,
      totalItems,
    });

    return {
      tree: lines.join("\n"),
      is_error: false,
      total_items: totalItems,
      truncated_dirs: truncatedDirs,
      hint,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function countDescendants(dir: DirNode): number {
  let count = 0;
  for (const child of dir.children) {
    count += 1;
    if (child.isDir) count += countDescendants(child);
  }
  return count;
}

function buildHint(args: {
  truncatedDirs: Array<{ path: string; shown: number; total: number }>;
  depthLimitedDirs: string[];
  totalItems: number;
}): string {
  const { truncatedDirs, depthLimitedDirs } = args;
  const parts: string[] = [];

  if (truncatedDirs.length > 0) {
    const first = truncatedDirs[0];
    if (first) {
      parts.push(
        `${truncatedDirs.length} ${truncatedDirs.length === 1 ? "directory was" : "directories were"} capped by items_per_dir; raise items_per_dir or call context_tree with path="${first.path}".`,
      );
    }
  }

  if (depthLimitedDirs.length > 0) {
    const first = depthLimitedDirs[0];
    if (first) {
      parts.push(
        `${depthLimitedDirs.length} ${depthLimitedDirs.length === 1 ? "directory was" : "directories were"} not expanded due to max_depth; raise max_depth or call context_tree with path="${first}".`,
      );
    }
  }

  if (parts.length === 0) return "Tree is complete.";
  return parts.join(" ");
}
