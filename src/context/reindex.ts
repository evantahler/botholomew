import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BotholomewConfig } from "../config/schemas.ts";
import { CONTEXT_DIR } from "../constants.ts";
import { withDb } from "../db/connection.ts";
import {
  type ChunkInput,
  deleteIndexedPath,
  getIndexedPath,
  listIndexedPaths,
  rebuildSearchIndex,
  upsertChunksForPath,
} from "../db/embeddings.ts";
import { logger } from "../utils/logger.ts";
import { chunkByTextSplit } from "./chunker.ts";
import { embed as defaultEmbed } from "./embedder.ts";
import { listContextDir } from "./store.ts";

/** Embed function shape — exported for tests that want to inject a fake. */
export type EmbedFn = (
  texts: string[],
  config: Required<BotholomewConfig>,
) => Promise<number[][]>;

/**
 * Walk every textual file under `<projectDir>/context/` and reconcile the
 * disk-backed search index. Adds new files, replaces stale ones whose
 * content_hash changed, and drops index rows for files that no longer exist.
 *
 * Uses the deterministic text splitter (`chunkByTextSplit`) — never the LLM
 * chunker — so a fresh project with no API key still indexes successfully.
 */
export async function reindexContext(
  projectDir: string,
  config: Required<BotholomewConfig>,
  dbPath: string,
  opts: {
    onProgress?: (msg: string) => void;
    /** Override embed for tests; defaults to the real WASM embedder. */
    embedFn?: EmbedFn;
  } = {},
): Promise<ReindexSummary> {
  const onProgress = opts.onProgress ?? (() => {});
  const embed = opts.embedFn ?? defaultEmbed;

  // 1. Walk context/ for every textual file along with its current
  //    (path, hash, mtime, size). Binary files are intentionally skipped —
  //    embeddings on bytes are meaningless and would just consume storage.
  onProgress("scanning files");
  const onDisk = await collectDiskFiles(projectDir);

  // 2. Read the existing index so we can decide what's add / update / skip /
  //    remove without re-embedding files that haven't changed.
  const indexed = await withDb(dbPath, listIndexedPaths);
  const indexedByPath = new Map(indexed.map((r) => [r.path, r]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let removed = 0;
  let chunksWritten = 0;

  // 3. For each file on disk: skip if (path, hash) is already indexed and the
  //    on-disk content hash matches; otherwise (re)embed.
  for (const file of onDisk) {
    const existing = indexedByPath.get(file.path);
    if (existing && existing.content_hash === file.contentHash) {
      unchanged++;
      indexedByPath.delete(file.path);
      continue;
    }

    onProgress(`embedding ${file.path}`);
    const text = await readFile(
      join(projectDir, CONTEXT_DIR, file.path),
      "utf-8",
    );
    const chunks = chunkByTextSplit(text);
    if (chunks.length === 0) {
      // Empty/whitespace-only file. Drop any stale rows for it; otherwise
      // there's nothing to index.
      if (existing) {
        await withDb(dbPath, (conn) => deleteIndexedPath(conn, file.path));
      }
      continue;
    }
    const vectors = await embed(
      chunks.map((c) => c.content),
      config,
    );
    const inputs: ChunkInput[] = chunks.map((c, i) => ({
      chunk_index: c.index,
      chunk_content: c.content,
      embedding: vectors[i] ?? new Array(config.embedding_dimension).fill(0),
    }));
    await withDb(dbPath, (conn) =>
      upsertChunksForPath(conn, {
        path: file.path,
        contentHash: file.contentHash,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
        chunks: inputs,
      }),
    );
    if (existing) updated++;
    else added++;
    chunksWritten += inputs.length;
    indexedByPath.delete(file.path);
  }

  // 4. Anything left in indexedByPath is in the index but not on disk →
  //    delete its rows so search results don't surface ghost files.
  for (const orphan of indexedByPath.keys()) {
    await withDb(dbPath, (conn) => deleteIndexedPath(conn, orphan));
    removed++;
  }

  if (added + updated + removed > 0) {
    onProgress("rebuilding FTS index");
    await withDb(dbPath, rebuildSearchIndex);
  }

  return { added, updated, unchanged, removed, chunksWritten };
}

export interface ReindexSummary {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  chunksWritten: number;
}

interface DiskFile {
  path: string;
  contentHash: string;
  mtimeMs: number;
  sizeBytes: number;
}

async function collectDiskFiles(projectDir: string): Promise<DiskFile[]> {
  const entries = await listContextDir(projectDir, "", { recursive: true });
  const out: DiskFile[] = [];
  for (const e of entries) {
    if (e.is_directory) continue;
    if (!e.is_textual) continue;
    const abs = join(projectDir, CONTEXT_DIR, e.path);
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(abs);
    } catch (err) {
      logger.warn(`reindex: skipping ${e.path}: ${err}`);
      continue;
    }
    const buf = await readFile(abs);
    const contentHash = createHash("sha256").update(buf).digest("hex");
    out.push({
      path: e.path,
      contentHash,
      mtimeMs: st.mtimeMs,
      sizeBytes: st.size,
    });
  }
  return out;
}

/**
 * Drop a single path from the index. Used by file/dir tool callers when
 * they delete or move a file and want the index to reflect it immediately
 * instead of waiting for the next reindex.
 */
export async function dropIndexedPath(
  dbPath: string,
  path: string,
): Promise<void> {
  await withDb(dbPath, async (conn) => {
    await deleteIndexedPath(conn, path);
    await rebuildSearchIndex(conn);
  });
}

export async function getIndexEntry(
  dbPath: string,
  path: string,
): Promise<{ chunks: number } | null> {
  const row = await withDb(dbPath, (conn) => getIndexedPath(conn, path));
  return row ? { chunks: row.chunk_count } : null;
}
