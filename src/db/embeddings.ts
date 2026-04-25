import { EMBEDDING_DIMENSION } from "../constants.ts";
import type { DbConnection } from "./connection.ts";
import { uuidv7 } from "./uuid.ts";

if (!Number.isInteger(EMBEDDING_DIMENSION) || EMBEDDING_DIMENSION <= 0) {
  throw new Error(`Invalid EMBEDDING_DIMENSION: ${EMBEDDING_DIMENSION}`);
}

export interface Embedding {
  id: string;
  context_item_id: string;
  chunk_index: number;
  chunk_content: string | null;
  title: string;
  description: string;
  embedding: number[];
  created_at: Date;
}

export interface EmbeddingSearchResult extends Embedding {
  score: number;
}

interface EmbeddingRow {
  id: string;
  context_item_id: string;
  chunk_index: number;
  chunk_content: string | null;
  title: string;
  description: string;
  embedding: number[] | null;
  created_at: string;
}

function rowToEmbedding(row: EmbeddingRow): Embedding {
  return {
    id: row.id,
    context_item_id: row.context_item_id,
    chunk_index: row.chunk_index,
    chunk_content: row.chunk_content,
    title: row.title,
    description: row.description,
    embedding: row.embedding ?? [],
    created_at: new Date(row.created_at),
  };
}

/**
 * Insert a single embedding row. Callers that bulk-write embeddings are
 * responsible for calling `rebuildSearchIndex()` afterward — the FTS index is
 * a snapshot and will not reflect new rows until rebuilt.
 */
export async function createEmbedding(
  conn: DbConnection,
  params: {
    contextItemId: string;
    chunkIndex: number;
    chunkContent: string | null;
    title: string;
    description?: string;
    embedding: number[];
  },
): Promise<Embedding> {
  const id = uuidv7();
  await conn.queryRun(
    `INSERT INTO embeddings (id, context_item_id, chunk_index, chunk_content, title, description, embedding)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7::FLOAT[${EMBEDDING_DIMENSION}])`,
    id,
    params.contextItemId,
    params.chunkIndex,
    params.chunkContent,
    params.title,
    params.description ?? "",
    params.embedding,
  );

  return {
    id,
    context_item_id: params.contextItemId,
    chunk_index: params.chunkIndex,
    chunk_content: params.chunkContent,
    title: params.title,
    description: params.description ?? "",
    embedding: params.embedding,
    created_at: new Date(),
  };
}

export async function getEmbeddingsForItem(
  conn: DbConnection,
  contextItemId: string,
): Promise<Embedding[]> {
  const rows = await conn.queryAll<EmbeddingRow>(
    "SELECT * FROM embeddings WHERE context_item_id = ?1 ORDER BY chunk_index ASC",
    contextItemId,
  );
  return rows.map(rowToEmbedding);
}

/**
 * Delete all embeddings for a context item. Callers are responsible for
 * calling `rebuildSearchIndex()` afterward — the FTS index is a snapshot and
 * will still reference the deleted rows until rebuilt.
 */
export async function deleteEmbeddingsForItem(
  conn: DbConnection,
  contextItemId: string,
): Promise<number> {
  const result = await conn.queryRun(
    "DELETE FROM embeddings WHERE context_item_id = ?1",
    contextItemId,
  );
  return result.changes;
}

interface VectorSearchRow extends EmbeddingRow {
  distance: number;
}

/**
 * Vector similarity search using DuckDB's array_cosine_distance().
 * With an HNSW index on the embedding column, DuckDB automatically
 * uses the index for top-k queries. Returns results sorted by
 * similarity (closest first), with score = 1 - distance.
 */
export async function searchEmbeddings(
  conn: DbConnection,
  queryEmbedding: number[],
  limit = 10,
): Promise<EmbeddingSearchResult[]> {
  const rows = await conn.queryAll<VectorSearchRow>(
    `SELECT *, array_cosine_distance(embedding, ?1::FLOAT[${EMBEDDING_DIMENSION}]) AS distance
     FROM embeddings
     ORDER BY distance ASC
     LIMIT ?2`,
    queryEmbedding,
    limit,
  );

  return rows.map((row) => ({
    ...rowToEmbedding(row),
    score: 1 - row.distance,
  }));
}

export interface HybridSearchResult extends EmbeddingSearchResult {
  drive: string | null;
  path: string | null;
}

/**
 * Rebuild the FTS index over (chunk_content, title). DuckDB's FTS index is a
 * snapshot — it does not update incrementally on INSERT/UPDATE/DELETE, so any
 * batch writer must call this once its transaction commits. Cheap at our
 * scale (hundreds to low thousands of rows).
 *
 * The trailing CHECKPOINT is load-bearing: `overwrite = 1` writes a
 * `DROP SCHEMA fts_main_embeddings` record into the WAL. If the WAL still
 * contains that drop on the next open, replay fails with "Cannot drop entry
 * 'fts_main_embeddings' because there are entries that depend on it". Forcing
 * a checkpoint flushes the WAL so the next open has nothing to replay.
 */
export async function rebuildSearchIndex(conn: DbConnection): Promise<void> {
  await conn.exec(
    "PRAGMA create_fts_index('embeddings', 'id', 'chunk_content', 'title', overwrite = 1)",
  );
  await conn.exec("CHECKPOINT");
}

export async function hybridSearch(
  conn: DbConnection,
  query: string,
  queryEmbedding: number[],
  limit = 10,
): Promise<HybridSearchResult[]> {
  const k = 60; // RRF constant

  // Keyword side: BM25 over chunk_content + title via the FTS extension.
  // `match_bm25` returns NULL for rows with no token overlap; we keep only
  // scored rows and order by descending score so RRF sees the best matches
  // at the lowest ranks. Stemming, stopwords, and tokenization are handled
  // by FTS — more query terms produce higher scores, which is exactly the
  // behaviour a naive per-token ILIKE loop fails to provide.
  const keywordRows = await conn.queryAll<EmbeddingRow>(
    `SELECT * FROM embeddings
     WHERE fts_main_embeddings.match_bm25(id, ?1) IS NOT NULL
     ORDER BY fts_main_embeddings.match_bm25(id, ?1) DESC
     LIMIT 100`,
    query,
  );

  const keywordRanked = keywordRows.map(rowToEmbedding);

  const vectorResults = await searchEmbeddings(conn, queryEmbedding, 100);

  const scores = new Map<string, { embedding: Embedding; score: number }>();

  for (const [i, emb] of keywordRanked.entries()) {
    const rrfScore = 1 / (k + i + 1);
    const existing = scores.get(emb.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(emb.id, { embedding: emb, score: rrfScore });
    }
  }

  for (const [i, emb] of vectorResults.entries()) {
    const rrfScore = 1 / (k + i + 1);
    const existing = scores.get(emb.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(emb.id, { embedding: emb, score: rrfScore });
    }
  }

  const merged = Array.from(scores.values());
  merged.sort((a, b) => b.score - a.score);

  const top = merged.slice(0, limit);
  if (top.length === 0) return [];

  // Look up drive + path from context_items for each surviving embedding
  const itemIds = Array.from(
    new Set(top.map((t) => t.embedding.context_item_id)),
  );
  const placeholders = itemIds.map((_, i) => `?${i + 1}`).join(", ");
  const itemRows = await conn.queryAll<{
    id: string;
    drive: string;
    path: string;
  }>(
    `SELECT id, drive, path FROM context_items WHERE id IN (${placeholders})`,
    ...itemIds,
  );
  const itemIndex = new Map(itemRows.map((r) => [r.id, r]));

  return top.map((entry) => {
    const item = itemIndex.get(entry.embedding.context_item_id);
    return {
      ...entry.embedding,
      score: entry.score,
      drive: item?.drive ?? null,
      path: item?.path ?? null,
    };
  });
}
