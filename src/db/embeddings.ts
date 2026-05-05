import { EMBEDDING_DIMENSION } from "../constants.ts";
import type { DbConnection } from "./connection.ts";

if (!Number.isInteger(EMBEDDING_DIMENSION) || EMBEDDING_DIMENSION <= 0) {
  throw new Error(`Invalid EMBEDDING_DIMENSION: ${EMBEDDING_DIMENSION}`);
}

/**
 * Disk-backed search index over `<projectDir>/context/`. One row per
 * `(path, chunk_index)`; `content_hash` is the file-level sha256 so the
 * reindex algorithm can detect adds, updates, and removals in one pass.
 */
export interface IndexedChunk {
  path: string;
  chunk_index: number;
  content_hash: string;
  chunk_content: string;
  embedding: number[];
  mtime_ms: number;
  size_bytes: number;
  indexed_at: Date;
}

interface IndexRow {
  path: string;
  chunk_index: number;
  content_hash: string;
  chunk_content: string;
  embedding: number[] | null;
  mtime_ms: number;
  size_bytes: number;
  indexed_at: string;
}

function rowToChunk(row: IndexRow): IndexedChunk {
  return {
    path: row.path,
    chunk_index: row.chunk_index,
    content_hash: row.content_hash,
    chunk_content: row.chunk_content,
    embedding: row.embedding ?? [],
    mtime_ms: Number(row.mtime_ms),
    size_bytes: Number(row.size_bytes),
    indexed_at: new Date(row.indexed_at),
  };
}

export interface ChunkInput {
  chunk_index: number;
  chunk_content: string;
  embedding: number[];
}

/**
 * Replace all rows for `path` with the supplied chunks. The file-level
 * `content_hash` / `mtime_ms` / `size_bytes` are stored on every row so a
 * subsequent reindex can short-circuit by comparing just those columns.
 */
export async function upsertChunksForPath(
  conn: DbConnection,
  params: {
    path: string;
    contentHash: string;
    mtimeMs: number;
    sizeBytes: number;
    chunks: ChunkInput[];
  },
): Promise<void> {
  await conn.queryRun("DELETE FROM context_index WHERE path = ?1", params.path);
  for (const c of params.chunks) {
    await conn.queryRun(
      `INSERT INTO context_index
       (path, chunk_index, content_hash, chunk_content, embedding, mtime_ms, size_bytes, indexed_at)
       VALUES (?1, ?2, ?3, ?4, ?5::FLOAT[${EMBEDDING_DIMENSION}], ?6, ?7, current_timestamp::VARCHAR)`,
      params.path,
      c.chunk_index,
      params.contentHash,
      c.chunk_content,
      c.embedding,
      params.mtimeMs,
      params.sizeBytes,
    );
  }
}

export async function deleteIndexedPath(
  conn: DbConnection,
  path: string,
): Promise<number> {
  const result = await conn.queryRun(
    "DELETE FROM context_index WHERE path = ?1",
    path,
  );
  return result.changes;
}

export interface IndexedPathSummary {
  path: string;
  content_hash: string;
  mtime_ms: number;
  size_bytes: number;
  chunk_count: number;
}

export async function listIndexedPaths(
  conn: DbConnection,
): Promise<IndexedPathSummary[]> {
  const rows = await conn.queryAll<{
    path: string;
    content_hash: string;
    mtime_ms: number;
    size_bytes: number;
    chunk_count: number;
  }>(
    `SELECT path,
            ANY_VALUE(content_hash) AS content_hash,
            ANY_VALUE(mtime_ms) AS mtime_ms,
            ANY_VALUE(size_bytes) AS size_bytes,
            COUNT(*) AS chunk_count
       FROM context_index
       GROUP BY path
       ORDER BY path ASC`,
  );
  return rows.map((r) => ({
    path: r.path,
    content_hash: r.content_hash,
    mtime_ms: Number(r.mtime_ms),
    size_bytes: Number(r.size_bytes),
    chunk_count: Number(r.chunk_count),
  }));
}

export async function getIndexedPath(
  conn: DbConnection,
  path: string,
): Promise<IndexedPathSummary | null> {
  const row = await conn.queryGet<{
    path: string;
    content_hash: string;
    mtime_ms: number;
    size_bytes: number;
    chunk_count: number;
  }>(
    `SELECT path,
            ANY_VALUE(content_hash) AS content_hash,
            ANY_VALUE(mtime_ms) AS mtime_ms,
            ANY_VALUE(size_bytes) AS size_bytes,
            COUNT(*) AS chunk_count
       FROM context_index
       WHERE path = ?1
       GROUP BY path`,
    path,
  );
  if (!row) return null;
  return {
    path: row.path,
    content_hash: row.content_hash,
    mtime_ms: Number(row.mtime_ms),
    size_bytes: Number(row.size_bytes),
    chunk_count: Number(row.chunk_count),
  };
}

export interface SearchResult extends IndexedChunk {
  score: number;
}

/**
 * Vector similarity over `context_index.embedding`. Returns chunks sorted by
 * cosine similarity (higher = closer). Skips rows whose embedding is NULL.
 */
export async function searchSemantic(
  conn: DbConnection,
  queryEmbedding: number[],
  limit = 10,
): Promise<SearchResult[]> {
  const rows = await conn.queryAll<IndexRow & { distance: number }>(
    `SELECT *, array_cosine_distance(embedding, ?1::FLOAT[${EMBEDDING_DIMENSION}]) AS distance
       FROM context_index
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT ?2`,
    queryEmbedding,
    limit,
  );
  return rows.map((row) => ({
    ...rowToChunk(row),
    score: 1 - row.distance,
  }));
}

/**
 * BM25 keyword search over (chunk_content, path). The FTS index is rebuilt
 * lazily by `rebuildSearchIndex`. Returns null-scoring rows filtered out.
 */
export async function searchKeyword(
  conn: DbConnection,
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  // The FTS index is created with `path` as input_id (see
  // rebuildSearchIndex), so match_bm25's first argument must be the path
  // value, not rowid. Passing rowid silently returns no hits — searchHybrid
  // would then degrade to semantic-only.
  const rows = await conn.queryAll<IndexRow & { score: number }>(
    `SELECT context_index.*,
            fts_main_context_index.match_bm25(context_index.path, ?1) AS score
       FROM context_index
      WHERE fts_main_context_index.match_bm25(context_index.path, ?1) IS NOT NULL
      ORDER BY score DESC
      LIMIT ?2`,
    query,
    limit,
  );
  return rows.map((row) => ({ ...rowToChunk(row), score: Number(row.score) }));
}

/**
 * Reciprocal-rank fusion of semantic + keyword results, deduped by
 * (path, chunk_index).
 */
export async function searchHybrid(
  conn: DbConnection,
  query: string,
  queryEmbedding: number[],
  limit = 10,
): Promise<SearchResult[]> {
  const k = 60;
  const [semantic, keyword] = await Promise.all([
    searchSemantic(conn, queryEmbedding, 100),
    searchKeyword(conn, query, 100).catch(() => [] as SearchResult[]),
  ]);

  const scores = new Map<string, { chunk: IndexedChunk; score: number }>();
  const key = (c: IndexedChunk) => `${c.path}::${c.chunk_index}`;

  for (let i = 0; i < semantic.length; i++) {
    const c = semantic[i];
    if (!c) continue;
    const existing = scores.get(key(c));
    const rrf = 1 / (k + i + 1);
    if (existing) existing.score += rrf;
    else scores.set(key(c), { chunk: c, score: rrf });
  }
  for (let i = 0; i < keyword.length; i++) {
    const c = keyword[i];
    if (!c) continue;
    const existing = scores.get(key(c));
    const rrf = 1 / (k + i + 1);
    if (existing) existing.score += rrf;
    else scores.set(key(c), { chunk: c, score: rrf });
  }
  const merged = [...scores.values()].sort((a, b) => b.score - a.score);
  return merged.slice(0, limit).map((m) => ({ ...m.chunk, score: m.score }));
}

/**
 * Rebuild the FTS index over (chunk_content, path). DuckDB's FTS index is a
 * snapshot — it does not update incrementally on INSERT/UPDATE/DELETE, so any
 * batch writer must call this once its transaction commits.
 *
 * The trailing CHECKPOINT is load-bearing (see history): `overwrite = 1`
 * writes a `DROP SCHEMA fts_main_context_index` record into the WAL; without
 * the checkpoint, replay on the next open can fail with "Cannot drop entry
 * 'fts_main_context_index' because there are entries that depend on it".
 */
export async function rebuildSearchIndex(conn: DbConnection): Promise<void> {
  // Skip if the table doesn't exist yet (e.g., fresh tests with an empty
  // schema). The FTS extension errors out on a missing table.
  const exists = await conn.queryGet<{ name: string }>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_name = 'context_index'",
  );
  if (!exists) return;
  await conn.exec(
    "PRAGMA create_fts_index('context_index', 'path', 'chunk_content', 'path', overwrite = 1)",
  );
  await conn.exec("CHECKPOINT");
}

export async function indexStats(conn: DbConnection): Promise<{
  paths: number;
  chunks: number;
  embedded: number;
}> {
  const row = await conn.queryGet<{
    paths: number;
    chunks: number;
    embedded: number;
  }>(
    `SELECT COUNT(DISTINCT path) AS paths,
            COUNT(*) AS chunks,
            COUNT(embedding) AS embedded
       FROM context_index`,
  );
  return {
    paths: Number(row?.paths ?? 0),
    chunks: Number(row?.chunks ?? 0),
    embedded: Number(row?.embedded ?? 0),
  };
}
