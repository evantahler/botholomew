import { z } from "zod";
import { parseDriveRef } from "../../context/drives.ts";
import { refreshContextItems } from "../../context/refresh.ts";
import {
  type ContextItem,
  listContextItems,
  listContextItemsByPrefix,
  resolveContextItem,
} from "../../db/context.ts";
import { buildContextTree } from "../dir/tree.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  ref: z
    .string()
    .optional()
    .describe(
      "UUID or 'drive:/path' of a single item, or 'drive:/prefix' to refresh a subtree. Mutually exclusive with `all`.",
    ),
  all: z
    .boolean()
    .optional()
    .describe(
      "Refresh every item that has an external origin (drive != 'agent'). Mutually exclusive with `ref`.",
    ),
});

const outputSchema = z.object({
  checked: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  missing: z.number(),
  reembedded: z.number(),
  chunks: z.number(),
  embeddings_skipped: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      drive: z.string(),
      path: z.string(),
      ref: z.string(),
      status: z.enum(["updated", "unchanged", "missing", "error"]),
      error: z.string().optional(),
    }),
  ),
  message: z.string(),
  is_error: z.boolean(),
  tree: z
    .string()
    .optional()
    .describe(
      "Snapshot of the context filesystem after the refresh so you can see what's currently stored.",
    ),
});

const empty = {
  checked: 0,
  updated: 0,
  unchanged: 0,
  missing: 0,
  reembedded: 0,
  chunks: 0,
  embeddings_skipped: false,
  items: [],
  tree: undefined as string | undefined,
};

export const contextRefreshTool = {
  name: "context_refresh",
  description:
    "[[ bash equivalent command: curl ]] Re-import items from their origin (disk / URL / MCP) and re-embed changed items. Use `ref` for a single item or subtree, or `all: true` for every non-agent item. URL fetches use the project's MCPX client when available and fall back to plain HTTP.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!input.ref && !input.all) {
      return {
        ...empty,
        message: "Provide a `ref` or set `all: true`.",
        is_error: true,
      };
    }
    if (input.ref && input.all) {
      return {
        ...empty,
        message: "`ref` and `all` are mutually exclusive.",
        is_error: true,
      };
    }

    let items: ContextItem[];
    if (input.all) {
      items = await listContextItems(ctx.conn);
    } else {
      const ref = input.ref as string;
      const exact = await resolveContextItem(ctx.conn, ref);
      if (exact) {
        items = [exact];
      } else {
        const parsed = parseDriveRef(ref);
        items = parsed
          ? await listContextItemsByPrefix(
              ctx.conn,
              parsed.drive,
              parsed.path,
              {
                recursive: true,
              },
            )
          : [];
      }
    }

    if (items.length === 0) {
      return {
        ...empty,
        message: `No context items match \`${input.ref ?? "all"}\`.`,
        is_error: true,
      };
    }

    const refreshable = items.filter((i) => i.drive !== "agent");
    if (refreshable.length === 0) {
      return {
        ...empty,
        message:
          "No refreshable items — everything matched lives on drive=agent (agent-authored content has no external origin).",
        is_error: false,
      };
    }

    const result = await refreshContextItems(
      ctx.conn,
      refreshable,
      ctx.config,
      ctx.mcpxClient,
    );

    const parts = [
      `Checked ${result.checked}`,
      `${result.updated} updated`,
      `${result.unchanged} unchanged`,
      `${result.missing} missing`,
      `${result.reembedded} re-embedded (${result.chunks} chunks)`,
    ];
    if (result.embeddings_skipped) {
      parts.push("embeddings skipped (no OpenAI API key configured)");
    }

    const firstItem = result.items[0];
    const treeDrive = firstItem ? firstItem.drive : undefined;
    const { tree } = await buildContextTree(ctx.conn, { drive: treeDrive });

    return {
      ...result,
      message: parts.join(", "),
      is_error: false,
      tree,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
