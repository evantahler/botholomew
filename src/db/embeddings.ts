import { EMBEDDING_DIMENSION } from "../constants.ts";
import type { DbConnection } from "./connection.ts";
import { uuidv7 } from "./uuid.ts";

export interface Embedding {
  id: string;
  context_item_id: string;
  chunk_index: number;
  chunk_content: string | null;
  title: string;
  description: string;
  source_path: string | null;
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
  source_path: string | null;
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
    source_path: row.source_path,
    embedding: row.embedding ?? [],
    created_at: new Date(row.created_at),
  };
}

export async function createEmbedding(
  conn: DbConnection,
  params: {
    contextItemId: string;
    chunkIndex: number;
    chunkContent: string | null;
    title: string;
    description?: string;
    sourcePath?: string | null;
    embedding: number[];
  },
): Promise<Embedding> {
  const id = uuidv7();
  await conn.queryRun(
    `INSERT INTO embeddings (id, context_item_id, chunk_index, chunk_content, title, description, source_path, embedding)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8::FLOAT[${EMBEDDING_DIMENSION}])`,
    id,
    params.contextItemId,
    params.chunkIndex,
    params.chunkContent,
    params.title,
    params.description ?? "",
    params.sourcePath ?? null,
    params.embedding,
  );

  return {
    id,
    context_item_id: params.contextItemId,
    chunk_index: params.chunkIndex,
    chunk_content: params.chunkContent,
    title: params.title,
    description: params.description ?? "",
    source_path: params.sourcePath ?? null,
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

export async function hybridSearch(
  conn: DbConnection,
  query: string,
  queryEmbedding: number[],
  limit = 10,
): Promise<EmbeddingSearchResult[]> {
  const k = 60; // RRF constant

  // Keyword search: match on chunk_content and title
  const keywordRows = await conn.queryAll<EmbeddingRow>(
    `SELECT * FROM embeddings
     WHERE chunk_content ILIKE '%' || ?1 || '%'
        OR title ILIKE '%' || ?1 || '%'
     LIMIT 100`,
    query,
  );

  const keywordRanked = keywordRows.map(rowToEmbedding);

  // Vector search via DuckDB VSS
  const vectorResults = await searchEmbeddings(conn, queryEmbedding, 100);

  // Reciprocal rank fusion
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

  return merged.slice(0, limit).map((entry) => ({
    ...entry.embedding,
    score: entry.score,
  }));
}
