import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import { type ContextItem, updateContextItem } from "../db/context.ts";
import { formatDriveRef } from "./drives.ts";
import { type FetchedContent, fetchUrl } from "./fetcher.ts";
import {
  type PreparedIngestion,
  prepareIngestion,
  storeIngestion,
} from "./ingest.ts";

export type RefreshItemStatus = "updated" | "unchanged" | "missing" | "error";

export interface RefreshItemResult {
  id: string;
  drive: string;
  path: string;
  ref: string;
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

/** Signature compatible with {@link fetchUrl}. Injectable for tests. */
export type FetchUrlFn = (
  url: string,
  config: Required<BotholomewConfig>,
  mcpxClient: McpxClient | null,
) => Promise<FetchedContent>;

/**
 * Refresh a batch of context items: re-read from origin, diff, update
 * content, and re-embed only the items that changed.
 *
 * Dispatches on `drive`:
 *   disk  → read from filesystem
 *   agent → skip (no external origin)
 *   other → re-fetch via `item.source_url` (captured at ingest time).
 *           The built-in `url` drive stores the URL as its path so it can
 *           also refresh directly from `path`. Any other drive with no
 *           `source_url` surfaces a per-item error — the user must re-add
 *           from URL. No code here knows anything about the remote
 *           service behind a drive.
 */
export async function refreshContextItems(
  conn: DbConnection,
  items: ContextItem[],
  config: Required<BotholomewConfig>,
  mcpxClient: McpxClient | null,
  opts: RefreshOptions = {},
  embedFn?: IngestEmbedFn,
  fetchFn: FetchUrlFn = fetchUrl,
): Promise<RefreshResult> {
  const refreshable = items.filter((i) => i.drive !== "agent");

  const results: RefreshItemResult[] = [];
  const toReembed: string[] = [];

  for (const [idx, item] of refreshable.entries()) {
    opts.onItemProgress?.(idx, refreshable.length);
    const base = {
      id: item.id,
      drive: item.drive,
      path: item.path,
      ref: formatDriveRef(item),
    };

    try {
      let content: string;

      if (item.drive === "disk") {
        const bunFile = Bun.file(item.path);
        if (!(await bunFile.exists())) {
          results.push({ ...base, status: "missing" });
          continue;
        }
        content = await bunFile.text();
      } else {
        const url =
          item.source_url ??
          (item.drive === "url" ? item.path.replace(/^\//, "") : null);
        if (!url) {
          results.push({
            ...base,
            status: "error",
            error: `Cannot refresh ${formatDriveRef(item)}: no source_url recorded. Re-add from the original URL.`,
          });
          continue;
        }
        const fetched = await fetchFn(url, config, mcpxClient);
        content = fetched.content;
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
  opts.onItemProgress?.(refreshable.length, refreshable.length);

  const updated = results.filter((r) => r.status === "updated").length;
  const unchanged = results.filter((r) => r.status === "unchanged").length;
  const missing = results.filter((r) => r.status === "missing").length;

  const hasEmbedder = !!embedFn || !!config.openai_api_key;
  if (toReembed.length === 0 || !hasEmbedder) {
    return {
      checked: refreshable.length,
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
    checked: refreshable.length,
    updated,
    unchanged,
    missing,
    reembedded: prepared.length,
    chunks,
    embeddings_skipped: false,
    items: results,
  };
}
