import type { BotholomewConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import { getContextItem, getContextItemById } from "../db/context.ts";
import {
  createEmbedding,
  deleteEmbeddingsForItem,
  rebuildSearchIndex,
} from "../db/embeddings.ts";
import { logger } from "../utils/logger.ts";
import { chunk } from "./chunker.ts";
import { type DriveTarget, formatDriveRef } from "./drives.ts";
import { embed as defaultEmbed } from "./embedder.ts";

type IngestEmbedFn = (texts: string[]) => Promise<number[][]>;

export interface PreparedIngestion {
  itemId: string;
  title: string;
  description: string;
  drive: string;
  path: string;
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
  const item = await getContextItemById(conn, itemId);
  if (!item) {
    logger.warn(`ingest: context item ${itemId} not found`);
    return null;
  }

  if (!item.is_textual || !item.content) {
    logger.debug(`ingest: skipping non-textual item ${itemId}`);
    return null;
  }

  // Resolve the embed function before chunking — if we can't embed, skip early
  const doEmbed =
    embedFn ??
    (config.openai_api_key
      ? (texts: string[]) => defaultEmbed(texts, config)
      : null);
  if (!doEmbed) {
    logger.debug("ingest: skipping embeddings (no OpenAI API key configured)");
    return null;
  }

  const chunks = await chunk(item.content, item.mime_type, config);
  if (chunks.length === 0) return null;

  const ref = formatDriveRef(item);
  const textsForEmbedding = chunks.map((c) => {
    const parts: string[] = [];
    if (item.title) parts.push(`Title: ${item.title}`);
    if (item.description) parts.push(`Description: ${item.description}`);
    parts.push(`Source: ${ref}`);
    parts.push(c.content);
    return parts.join("\n");
  });
  const vectors = await doEmbed(textsForEmbedding);

  return {
    itemId,
    title: item.title,
    description: item.description,
    drive: item.drive,
    path: item.path,
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
 * All statements in BEGIN/COMMIT/ROLLBACK must share one connection, so the
 * caller must pass a connection that lives long enough for the transaction
 * (the tool executor wraps each tool call in `withDb`, which satisfies this).
 */
export async function storeIngestion(
  conn: DbConnection,
  prepared: PreparedIngestion,
): Promise<IngestionResult> {
  let isUpdate = false;
  await conn.exec("BEGIN TRANSACTION");
  try {
    const deleted = await deleteEmbeddingsForItem(conn, prepared.itemId);
    isUpdate = deleted > 0;

    for (const [i, c] of prepared.chunks.entries()) {
      const v = prepared.vectors[i];
      if (!v) continue;
      await createEmbedding(conn, {
        contextItemId: prepared.itemId,
        chunkIndex: c.index,
        chunkContent: c.content,
        title: prepared.title,
        description: prepared.description,
        embedding: v,
      });
    }

    await conn.queryRun(
      "UPDATE context_items SET indexed_at = current_timestamp::VARCHAR WHERE id = ?1",
      prepared.itemId,
    );

    await conn.exec("COMMIT");
  } catch (err) {
    await conn.exec("ROLLBACK");
    throw err;
  }

  // FTS index is a snapshot and doesn't see the writes above until rebuilt.
  await rebuildSearchIndex(conn);

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
  return (await storeIngestion(conn, prepared)).chunks;
}

/**
 * Ingest a context item by its (drive, path) pair.
 */
export async function ingestByPath(
  conn: DbConnection,
  target: DriveTarget,
  config: Required<BotholomewConfig>,
  embedFn?: IngestEmbedFn,
): Promise<number> {
  const item = await getContextItem(conn, target);
  if (!item) {
    logger.warn(`ingest: no item at ${formatDriveRef(target)}`);
    return 0;
  }
  return ingestContextItem(conn, item.id, config, embedFn);
}
