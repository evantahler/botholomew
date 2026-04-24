import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import type { DbConnection } from "../../db/connection.ts";
import {
  countContextItemsByPrefix,
  listContextItemsByPrefix,
  listDriveSummaries,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_ITEMS_PER_DIR = 15;
const HARD_FETCH_CAP = 1000;

export interface BuildContextTreeOptions {
  drive?: string;
  path?: string;
  maxDepth?: number;
  itemsPerDir?: number;
}

export interface BuildContextTreeResult {
  tree: string;
  total_items: number;
  truncated_dirs: Array<{ path: string; shown: number; total: number }>;
  hint: string;
}

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

/**
 * Build a markdown tree for a single drive, or — when no drive is given — a
 * top-level summary listing every drive with its item count.
 */
export async function buildContextTree(
  conn: DbConnection,
  options: BuildContextTreeOptions = {},
): Promise<BuildContextTreeResult> {
  if (!options.drive) {
    const summaries = await listDriveSummaries(conn);
    if (summaries.length === 0) {
      return {
        tree: "(no drives — context is empty)",
        total_items: 0,
        truncated_dirs: [],
        hint: "No context has been ingested yet. Use `context add` from the CLI to ingest files or URLs.",
      };
    }
    const lines = [
      "Drives:",
      ...summaries.map(
        (s) =>
          `  ${s.drive}:/  (${s.count} ${s.count === 1 ? "item" : "items"})`,
      ),
    ];
    const total = summaries.reduce((sum, s) => sum + s.count, 0);
    return {
      tree: lines.join("\n"),
      total_items: total,
      truncated_dirs: [],
      hint: `Call context_tree with drive="<name>" to drill into a drive.`,
    };
  }

  const drive = options.drive;
  const path = options.path ?? "/";
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const itemsPerDir = options.itemsPerDir ?? DEFAULT_ITEMS_PER_DIR;
  const normalizedPath = path.endsWith("/") ? path : `${path}/`;
  const rootLabel = formatDriveRef({ drive, path });

  const totalItems = await countContextItemsByPrefix(conn, drive, path, {
    recursive: true,
  });

  if (totalItems === 0) {
    return {
      tree: `${rootLabel}\n  (empty)`,
      total_items: 0,
      truncated_dirs: [],
      hint: "Directory is empty.",
    };
  }

  const items = await listContextItemsByPrefix(conn, drive, path, {
    recursive: true,
    limit: HARD_FETCH_CAP,
  });

  const root: DirNode = {
    name: rootLabel,
    fullPath: path,
    isDir: true,
    children: [],
  };
  const dirIndex = new Map<string, DirNode>();
  dirIndex.set(stripTrailingSlash(path), root);

  for (const item of items) {
    const relative = item.path.slice(normalizedPath.length);
    if (relative.length === 0) continue;
    const parts = relative.split("/").filter((p) => p.length > 0);
    const isExplicitDir = item.mime_type === "inode/directory";

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

  const lines: string[] = [rootLabel];

  const render = (dir: DirNode, indent: string, currentDepth: number): void => {
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

  return {
    tree: lines.join("\n"),
    total_items: totalItems,
    truncated_dirs: truncatedDirs,
    hint: buildHint({ truncatedDirs, depthLimitedDirs, totalItems, drive }),
  };
}

const inputSchema = z.object({
  drive: z
    .string()
    .optional()
    .describe(
      "Drive to explore (e.g. 'disk', 'agent'). Omit to list every drive with its item count — useful as a first call.",
    ),
  path: z
    .string()
    .optional()
    .describe("Root path for the tree within the drive (defaults to /)"),
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

export const contextTreeTool = {
  name: "context_tree",
  description:
    "[[ bash equivalent command: tree ]] Explore your context with a bird's-eye view. Call with no `drive` to list every drive; call with a drive (and optional path) to render a tree of that drive. Returns a markdown-style tree; tune max_depth and items_per_dir to bound output.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const result = await buildContextTree(ctx.conn, {
      drive: input.drive,
      path: input.path,
      maxDepth: input.max_depth,
      itemsPerDir: input.items_per_dir,
    });
    return { ...result, is_error: false };
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
  drive: string;
}): string {
  const { truncatedDirs, depthLimitedDirs, drive } = args;
  const parts: string[] = [];

  if (truncatedDirs.length > 0) {
    const first = truncatedDirs[0];
    if (first) {
      parts.push(
        `${truncatedDirs.length} ${truncatedDirs.length === 1 ? "directory was" : "directories were"} capped by items_per_dir; raise items_per_dir or call context_tree with drive="${drive}", path="${first.path}".`,
      );
    }
  }

  if (depthLimitedDirs.length > 0) {
    const first = depthLimitedDirs[0];
    if (first) {
      parts.push(
        `${depthLimitedDirs.length} ${depthLimitedDirs.length === 1 ? "directory was" : "directories were"} not expanded due to max_depth; raise max_depth or call context_tree with drive="${drive}", path="${first}".`,
      );
    }
  }

  if (parts.length === 0) return "Tree is complete.";
  return parts.join(" ");
}
