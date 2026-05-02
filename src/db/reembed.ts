import type { BotholomewConfig } from "../config/schemas.ts";
import { embed } from "../context/embedder.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./connection.ts";
import { rebuildSearchIndex } from "./embeddings.ts";

interface PendingRow {
  id: string;
  chunk_content: string | null;
  title: string;
  description: string;
  drive: string | null;
  path: string | null;
}

const BATCH_SIZE = 32;

function buildEmbeddingInput(row: PendingRow): string {
  const parts: string[] = [];
  if (row.title) parts.push(`Title: ${row.title}`);
  if (row.description) parts.push(`Description: ${row.description}`);
  if (row.drive && row.path) parts.push(`Source: ${row.drive}:${row.path}`);
  if (row.chunk_content) parts.push(row.chunk_content);
  return parts.join("\n");
}

interface ReembedOptions {
  /**
   * `"missing"` (default) — only re-embed rows where `embedding IS NULL`.
   * `"all"` — re-embed every row, including ones that already have a vector.
   *           Use this after changing `embedding_model` so old vectors don't
   *           sit alongside new ones in a different space.
   */
  mode?: "missing" | "all";
}

/**
 * Recompute embeddings for rows in the embeddings table.
 *
 * Default mode (`"missing"`) only touches NULL rows — the case after migration
 * 18 leaves existing rows with no vector. The `context reembed` CLI command
 * passes `mode: "all"` to force a full rebuild after the user changes
 * `embedding_model`.
 *
 * Each batch is its own withDb so the file lock releases between embedding
 * calls — long sweeps don't block other workers from acquiring the DB.
 */
export async function reembedMissingVectors(
  dbPath: string,
  config: Required<BotholomewConfig>,
  options: ReembedOptions = {},
): Promise<void> {
  const mode = options.mode ?? "missing";
  const filter = mode === "all" ? "" : "WHERE embedding IS NULL";

  const total = await withDb(dbPath, async (conn) => {
    const row = await conn.queryGet<{ count: number }>(
      `SELECT count(*)::INTEGER AS count FROM embeddings ${filter}`,
    );
    return row?.count ?? 0;
  });

  if (total === 0) {
    logger.info("No embeddings to recompute.");
    return;
  }

  logger.info(
    `re-embedding ${total} row${total === 1 ? "" : "s"} with model ${config.embedding_model}`,
  );

  let processed = 0;
  while (processed < total) {
    const batch = await withDb(dbPath, async (conn) => {
      const offsetClause = mode === "all" ? `LIMIT ?1 OFFSET ?2` : `LIMIT ?1`;
      const sql = `SELECT e.id, e.chunk_content, e.title, e.description, ci.drive, ci.path
         FROM embeddings e
         LEFT JOIN context_items ci ON ci.id = e.context_item_id
         ${filter}
         ORDER BY e.id
         ${offsetClause}`;
      return mode === "all"
        ? conn.queryAll<PendingRow>(sql, BATCH_SIZE, processed)
        : conn.queryAll<PendingRow>(sql, BATCH_SIZE);
    });

    if (batch.length === 0) break;

    const inputs = batch.map(buildEmbeddingInput);
    const vectors = await embed(inputs, config);

    await withDb(dbPath, async (conn) => {
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const vec = vectors[i];
        if (!row || !vec) continue;
        await conn.queryRun(
          `UPDATE embeddings
           SET embedding = ?1::FLOAT[${config.embedding_dimension}]
           WHERE id = ?2`,
          vec,
          row.id,
        );
      }
    });

    processed += batch.length;
    logger.info(`  re-embedded ${processed}/${total}`);
  }

  await withDb(dbPath, (conn) => rebuildSearchIndex(conn));
  logger.success(`re-embed complete (${processed} rows)`);
}
