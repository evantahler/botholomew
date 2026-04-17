import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import { type ContextItem, updateContextItem } from "../db/context.ts";
import { fetchUrl } from "./fetcher.ts";
import {
  type PreparedIngestion,
  prepareIngestion,
  storeIngestion,
} from "./ingest.ts";

export type RefreshItemStatus = "updated" | "unchanged" | "missing" | "error";

export interface RefreshItemResult {
  id: string;
  context_path: string;
  source_path: string;
  source_type: "file" | "url";
  status: RefreshItemStatus;
  error?: string;
}

export interface RefreshResult {
  checked: number;
  updated: number;
  unchanged: number;
  missing: number;
  reembedded: number;
  chunks: number;
  embeddings_skipped: boolean;
  items: RefreshItemResult[];
}

export interface RefreshOptions {
  concurrency?: number;
  onItemProgress?: (done: number, total: number) => void;
  onEmbedProgress?: (done: number, total: number) => void;
}

type IngestEmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Refresh a batch of context items: re-read source (file or URL), diff, update
 * content, and re-embed only the items that changed. Side-effect free on the
 * outside world — the caller owns logging and spinners.
 */
export async function refreshContextItems(
  conn: DbConnection,
  items: ContextItem[],
  config: Required<BotholomewConfig>,
  mcpxClient: McpxClient | null,
  opts: RefreshOptions = {},
  embedFn?: IngestEmbedFn,
): Promise<RefreshResult> {
  const sourced = items.filter(
    (i): i is ContextItem & { source_path: string } => !!i.source_path,
  );

  const results: RefreshItemResult[] = [];
  const toReembed: string[] = [];

  // Phase 1: read each source, diff against stored content, update when changed.
  for (const [idx, item] of sourced.entries()) {
    opts.onItemProgress?.(idx, sourced.length);
    const base = {
      id: item.id,
      context_path: item.context_path,
      source_path: item.source_path,
      source_type: item.source_type,
    };

    try {
      let content: string;

      if (item.source_type === "url") {
        const fetched = await fetchUrl(item.source_path, config, mcpxClient);
        content = fetched.content;
      } else {
        const bunFile = Bun.file(item.source_path);
        if (!(await bunFile.exists())) {
          results.push({ ...base, status: "missing" });
          continue;
        }
        content = await bunFile.text();
      }

      if (content === item.content) {
        results.push({ ...base, status: "unchanged" });
        continue;
      }

      await updateContextItem(conn, item.id, { content });
      results.push({ ...base, status: "updated" });
      toReembed.push(item.id);
    } catch (err) {
      results.push({
        ...base,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  opts.onItemProgress?.(sourced.length, sourced.length);

  const updated = results.filter((r) => r.status === "updated").length;
  const unchanged = results.filter((r) => r.status === "unchanged").length;
  const missing = results.filter((r) => r.status === "missing").length;

  // Phase 2: re-embed changed items. Skip cleanly if no OpenAI key.
  const hasEmbedder = !!embedFn || !!config.openai_api_key;
  if (toReembed.length === 0 || !hasEmbedder) {
    return {
      checked: sourced.length,
      updated,
      unchanged,
      missing,
      reembedded: 0,
      chunks: 0,
      embeddings_skipped: toReembed.length > 0 && !hasEmbedder,
      items: results,
    };
  }

  const concurrency = opts.concurrency ?? 10;
  const prepared: PreparedIngestion[] = [];
  let completed = 0;

  for (let i = 0; i < toReembed.length; i += concurrency) {
    const batch = toReembed.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (id) => {
        const r = await prepareIngestion(conn, id, config, embedFn);
        completed++;
        opts.onEmbedProgress?.(completed, toReembed.length);
        return r;
      }),
    );
    for (const r of batchResults) {
      if (r) prepared.push(r);
    }
  }

  let chunks = 0;
  for (const p of prepared) {
    const result = await storeIngestion(conn, p);
    chunks += result.chunks;
  }

  return {
    checked: sourced.length,
    updated,
    unchanged,
    missing,
    reembedded: prepared.length,
    chunks,
    embeddings_skipped: false,
    items: results,
  };
}
