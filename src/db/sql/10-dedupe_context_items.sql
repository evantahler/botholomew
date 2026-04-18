-- Older DBs could accumulate duplicate rows in context_items with the same
-- context_path: migration 4's CREATE UNIQUE INDEX IF NOT EXISTS silently left
-- the index metadata in place without enforcing it when duplicates predated
-- the migration. The resulting "corrupt" unique index triggers a native
-- crash in @duckdb/node-api on UPDATE ... RETURNING. Rebuild cleanly.
DROP INDEX IF EXISTS idx_context_items_context_path;

DELETE FROM embeddings WHERE context_item_id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY context_path
      ORDER BY updated_at DESC, id DESC
    ) AS rn FROM context_items
  ) WHERE rn > 1
);

DELETE FROM context_items WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY context_path
      ORDER BY updated_at DESC, id DESC
    ) AS rn FROM context_items
  ) WHERE rn > 1
);

CREATE UNIQUE INDEX idx_context_items_context_path ON context_items(context_path);
