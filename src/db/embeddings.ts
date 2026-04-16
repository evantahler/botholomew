import { EMBEDDING_DIMENSION } from "../constants.ts";
import type { DbConnection } from "./connection.ts";
import { uuidv7 } from "./uuid.ts";

// Track which connections have been initialized for vector search
const initializedConnections = new WeakSet<DbConnection>();

/**
 * Initialize sqlite-vector on the embeddings table for this connection.
 * Must be called once per connection before vector operations.
 * The dimension parameter allows overriding for tests.
 */
export function initVectorSearch(
  conn: DbConnection,
  dimension = EMBEDDING_DIMENSION,
): void {
  if (initializedConnections.has(conn)) return;
  conn.exec(
    `SELECT vector_init('embeddings', 'embedding', 'dimension=${dimension},type=FLOAT32,distance=COSINE')`,
  );
  initializedConnections.add(conn);
}

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
  embedding: Uint8Array | null;
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
    embedding: row.embedding
      ? Array.from(new Float32Array(row.embedding.buffer))
      : [],
    created_at: new Date(row.created_at),
  };
}

export function createEmbedding(
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
): Embedding {
  const id = uuidv7();
  conn
    .query(
      `INSERT INTO embeddings (id, context_item_id, chunk_index, chunk_content, title, description, source_path, embedding)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, vector_as_f32(?8))`,
    )
    .run(
      id,
      params.contextItemId,
      params.chunkIndex,
      params.chunkContent,
      params.title,
      params.description ?? "",
      params.sourcePath ?? null,
      JSON.stringify(params.embedding),
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

export function getEmbeddingsForItem(
  conn: DbConnection,
  contextItemId: string,
): Embedding[] {
  const rows = conn
    .query(
      "SELECT * FROM embeddings WHERE context_item_id = ?1 ORDER BY chunk_index ASC",
    )
    .all(contextItemId) as EmbeddingRow[];
  return rows.map(rowToEmbedding);
}

export function deleteEmbeddingsForItem(
  conn: DbConnection,
  contextItemId: string,
): number {
  const result = conn
    .query("DELETE FROM embeddings WHERE context_item_id = ?1")
    .run(contextItemId);
  return result.changes;
}

interface VectorScanRow extends EmbeddingRow {
  distance: number;
}

/**
 * Vector similarity search using sqlite-vector's SIMD-accelerated
 * cosine distance via vector_full_scan(). Returns results sorted by
 * similarity (closest first), with score = 1 - distance.
 */
export function searchEmbeddings(
  conn: DbConnection,
  queryEmbedding: number[],
  limit = 10,
): EmbeddingSearchResult[] {
  const queryJson = JSON.stringify(queryEmbedding);

  const rows = conn
    .query(
      `SELECT e.*, v.distance
       FROM embeddings e
       JOIN vector_full_scan('embeddings', 'embedding', vector_as_f32(?1), ?2) v
         ON e.rowid = v.rowid`,
    )
    .all(queryJson, limit) as VectorScanRow[];

  return rows.map((row) => ({
    ...rowToEmbedding(row),
    score: 1 - row.distance,
  }));
}

export function hybridSearch(
  conn: DbConnection,
  query: string,
  queryEmbedding: number[],
  limit = 10,
): EmbeddingSearchResult[] {
  const k = 60; // RRF constant

  // Keyword search: match on chunk_content and title
  const keywordRows = conn
    .query(
      `SELECT * FROM embeddings
       WHERE chunk_content LIKE '%' || ?1 || '%'
          OR title LIKE '%' || ?1 || '%'
       LIMIT 100`,
    )
    .all(query) as EmbeddingRow[];

  const keywordRanked = keywordRows.map(rowToEmbedding);

  // Vector search via sqlite-vector
  const vectorResults = searchEmbeddings(conn, queryEmbedding, 100);

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
