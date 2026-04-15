import type { ResolvedConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import { getContextItem, getContextItemByPath } from "../db/context.ts";
import {
  createEmbedding,
  deleteEmbeddingsForItem,
  initVectorSearch,
} from "../db/embeddings.ts";
import { logger } from "../utils/logger.ts";
import { chunk } from "./chunker.ts";
import type { EmbedFn } from "./embedder.ts";
import { embed as defaultEmbed } from "./embedder.ts";

/**
 * Full ingestion pipeline for a context item:
 * 1. Fetch item from DB
 * 2. Skip if non-textual or empty
 * 3. Chunk content and embed chunks (outside transaction)
 * 4. In a transaction: delete old embeddings, store new ones, update indexed_at
 */
export async function ingestContextItem(
  conn: DbConnection,
  itemId: string,
  config: ResolvedConfig,
  embedFn: EmbedFn = defaultEmbed,
): Promise<number> {
  const item = await getContextItem(conn, itemId);
  if (!item) {
    logger.warn(`ingest: context item ${itemId} not found`);
    return 0;
  }

  if (!item.is_textual || !item.content) {
    logger.debug(`ingest: skipping non-textual item ${itemId}`);
    return 0;
  }

  // Initialize vector search (idempotent)
  initVectorSearch(conn);

  // Chunk and embed outside the transaction (may involve LLM/model calls)
  const chunks = await chunk(item.content, item.mime_type, config);
  if (chunks.length === 0) return 0;

  const vectors = await embedFn(chunks.map((c) => c.content));

  // Wrap DB mutations in a transaction
  conn.exec("BEGIN");
  try {
    // Clear stale embeddings
    deleteEmbeddingsForItem(conn, itemId);

    // Store each chunk + embedding
    for (const [i, c] of chunks.entries()) {
      const v = vectors[i];
      if (!v) continue;
      createEmbedding(conn, {
        contextItemId: itemId,
        chunkIndex: c.index,
        chunkContent: c.content,
        title: item.title,
        description: item.description,
        sourcePath: item.source_path,
        embedding: v,
      });
    }

    // Mark as indexed
    conn
      .query(
        "UPDATE context_items SET indexed_at = datetime('now') WHERE id = ?1",
      )
      .run(itemId);

    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }

  logger.debug(
    `ingest: indexed ${chunks.length} chunks for "${item.title}" (${itemId})`,
  );
  return chunks.length;
}

/**
 * Ingest a context item by its virtual path.
 */
export async function ingestByPath(
  conn: DbConnection,
  contextPath: string,
  config: ResolvedConfig,
  embedFn: EmbedFn = defaultEmbed,
): Promise<number> {
  const item = await getContextItemByPath(conn, contextPath);
  if (!item) {
    logger.warn(`ingest: no item at path ${contextPath}`);
    return 0;
  }
  return ingestContextItem(conn, item.id, config, embedFn);
}
