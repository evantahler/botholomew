import { z } from "zod";
import { refreshContextItems } from "../../context/refresh.ts";
import {
  type ContextItem,
  listContextItems,
  listContextItemsByPrefix,
  resolveContextItem,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "Context path or ID of a single item, or a path prefix to refresh a subtree. Mutually exclusive with `all`.",
    ),
  all: z
    .boolean()
    .optional()
    .describe(
      "Refresh every item that has a source_path (file or URL). Mutually exclusive with `path`.",
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
      context_path: z.string(),
      source_path: z.string(),
      source_type: z.enum(["file", "url"]),
      status: z.enum(["updated", "unchanged", "missing", "error"]),
      error: z.string().optional(),
    }),
  ),
  message: z.string(),
  is_error: z.boolean(),
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
};

export const contextRefreshTool = {
  name: "context_refresh",
  description:
    "Re-read source files from disk / re-fetch source URLs, update stored content if it changed, and re-embed only changed items. Use `path` for a single item or subtree, or `all: true` for every sourced item. Items without a source_path are skipped. URL fetches use the project's MCPX client when available and fall back to plain HTTP.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!input.path && !input.all) {
      return {
        ...empty,
        message: "Provide a `path` or set `all: true`.",
        is_error: true,
      };
    }
    if (input.path && input.all) {
      return {
        ...empty,
        message: "`path` and `all` are mutually exclusive.",
        is_error: true,
      };
    }

    let items: ContextItem[];
    if (input.all) {
      items = await listContextItems(ctx.conn);
    } else {
      const exact = await resolveContextItem(ctx.conn, input.path as string);
      items = exact
        ? [exact]
        : await listContextItemsByPrefix(ctx.conn, input.path as string, {
            recursive: true,
          });
    }

    if (items.length === 0) {
      return {
        ...empty,
        message: `No context items match \`${input.path ?? "all"}\`.`,
        is_error: true,
      };
    }

    const sourced = items.filter((i) => i.source_path);
    if (sourced.length === 0) {
      return {
        ...empty,
        message:
          "No matching items have a source_path — nothing to refresh. (Items created via `context write` are not sourced.)",
        is_error: false,
      };
    }

    const result = await refreshContextItems(
      ctx.conn,
      sourced,
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

    return {
      ...result,
      message: parts.join(", "),
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
