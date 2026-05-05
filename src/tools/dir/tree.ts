import { z } from "zod";
import {
  buildTree,
  NotFoundError,
  type TreeNode,
} from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const DEFAULT_MAX_DEPTH = 10;

export interface BuildContextTreeResult {
  tree: string;
  total_items: number;
  hint: string;
}

/**
 * Render a TreeNode as an indented string. Files are listed; directories show
 * children. Depth is enforced inside `buildTree`.
 */
function renderTree(node: TreeNode, prefix = "", isLast = true): string[] {
  const lines: string[] = [];
  const connector = prefix === "" ? "" : isLast ? "└── " : "├── ";
  const label = node.is_directory ? `${node.name}/` : node.name;
  lines.push(`${prefix}${connector}${label}`);
  if (node.is_directory && node.children) {
    const childPrefix =
      prefix + (prefix === "" ? "" : isLast ? "    " : "│   ");
    const children = node.children;
    children.forEach((c, i) => {
      const last = i === children.length - 1;
      lines.push(...renderTree(c, childPrefix, last));
    });
  }
  return lines;
}

function countItems(node: TreeNode): number {
  if (!node.is_directory) return 1;
  let total = 0;
  for (const c of node.children ?? []) total += countItems(c);
  return total;
}

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .default("")
    .describe(
      "Directory path under context/ to render (defaults to the context root).",
    ),
  max_depth: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_MAX_DEPTH)
    .describe(
      `Maximum depth of directories to render (defaults to ${DEFAULT_MAX_DEPTH}).`,
    ),
});

const outputSchema = z.object({
  tree: z.string(),
  total_items: z.number(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const contextTreeTool = {
  name: "context_tree",
  description:
    "[[ bash equivalent command: tree ]] Render the file tree under context/ (or a sub-directory).",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const node = await buildTree(
        ctx.projectDir,
        input.path ?? "",
        input.max_depth,
      );
      return {
        tree: renderTree(node).join("\n"),
        total_items: countItems(node),
        is_error: false,
      };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          tree: "",
          total_items: 0,
          is_error: true,
          error_type: "not_found",
          message: `No path at context/${err.path}`,
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;

/**
 * Convenience for callers that want a string tree from outside the tool layer.
 */
export async function buildContextTree(
  projectDir: string,
  opts: { path?: string; maxDepth?: number } = {},
): Promise<BuildContextTreeResult> {
  const node = await buildTree(
    projectDir,
    opts.path ?? "",
    opts.maxDepth ?? DEFAULT_MAX_DEPTH,
  );
  return {
    tree: renderTree(node).join("\n"),
    total_items: countItems(node),
    hint: "",
  };
}
