import type { BotholomewConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import { getContextItem, getContextItemByPath } from "../db/context.ts";
import {
  createEmbedding,
  deleteEmbeddingsForItem,
  initVectorSearch,
} from "../db/embeddings.ts";
import { logger } from "../utils/logger.ts";
import { chunk } from "./chunker.ts";
import { embed as defaultEmbed } from "./embedder.ts";

type IngestEmbedFn = (texts: string[]) => Promise<number[][]>;

export interface PreparedIngestion {
  itemId: string;
  title: string;
  description: string;
  sourcePath: string | null;
  chunks: { index: number; content: string }[];
  vectors: number[][];
}

/**
 * Prepare an item for ingestion: chunk content and compute embeddings.
 * This is the expensive (parallelizable) part — no DB writes happen here.
 */
export async function prepareIngestion(
  conn: DbConnection,
  itemId: string,
  config: Required<BotholomewConfig>,
  embedFn?: IngestEmbedFn,
): Promise<PreparedIngestion | null> {
  const item = await getContextItem(conn, itemId);
  if (!item) {
    logger.warn(`ingest: context item ${itemId} not found`);
    return null;
  }

  if (!item.is_textual || !item.content) {
    logger.debug(`ingest: skipping non-textual item ${itemId}`);
    return null;
  }

  const chunks = await chunk(item.content, item.mime_type, config);
  if (chunks.length === 0) return null;

  const doEmbed =
    embedFn ??
    (config.openai_api_key
      ? (texts: string[]) => defaultEmbed(texts, config)
      : null);
  if (!doEmbed) {
    logger.debug("ingest: skipping embeddings (no OpenAI API key configured)");
    return null;
  }

  const vectors = await doEmbed(chunks.map((c) => c.content));

  return {
    itemId,
    title: item.title,
    description: item.description,
    sourcePath: item.source_path,
    chunks,
    vectors,
  };
}

export interface IngestionResult {
  chunks: number;
  isUpdate: boolean;
}

/**
 * Store a prepared ingestion into the database.
 * This is fast (synchronous DB writes) and must be called sequentially.
 */
export function storeIngestion(
  conn: DbConnection,
  prepared: PreparedIngestion,
): IngestionResult {
  initVectorSearch(conn);

  let isUpdate = false;
  conn.exec("BEGIN");
  try {
    const deleted = deleteEmbeddingsForItem(conn, prepared.itemId);
    isUpdate = deleted > 0;

    for (const [i, c] of prepared.chunks.entries()) {
      const v = prepared.vectors[i];
      if (!v) continue;
      createEmbedding(conn, {
        contextItemId: prepared.itemId,
        chunkIndex: c.index,
        chunkContent: c.content,
        title: prepared.title,
        description: prepared.description,
        sourcePath: prepared.sourcePath,
        embedding: v,
      });
    }

    conn
      .query(
        "UPDATE context_items SET indexed_at = datetime('now') WHERE id = ?1",
      )
      .run(prepared.itemId);

    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }

  const action = isUpdate ? "updated" : "added";
  logger.info(
    `ingest: ${action} ${prepared.chunks.length} chunks for "${prepared.title}" (${prepared.itemId})`,
  );
  return { chunks: prepared.chunks.length, isUpdate };
}

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
  config: Required<BotholomewConfig>,
  embedFn?: IngestEmbedFn,
): Promise<number> {
  const prepared = await prepareIngestion(conn, itemId, config, embedFn);
  if (!prepared) return 0;
  return storeIngestion(conn, prepared).chunks;
}

/**
 * Ingest a context item by its virtual path.
 */
export async function ingestByPath(
  conn: DbConnection,
  contextPath: string,
  config: Required<BotholomewConfig>,
  embedFn?: IngestEmbedFn,
): Promise<number> {
  const item = await getContextItemByPath(conn, contextPath);
  if (!item) {
    logger.warn(`ingest: no item at path ${contextPath}`);
    return 0;
  }
  return ingestContextItem(conn, item.id, config, embedFn);
}
