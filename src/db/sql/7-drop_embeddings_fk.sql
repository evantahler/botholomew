-- DuckDB implements UPDATE as delete+insert on tables with unique indexes.
-- The foreign key from embeddings → context_items causes every UPDATE to
-- context_items to fail when embeddings exist. Cascading deletes are already
-- handled in application code (deleteContextItem), so the FK is redundant.
--
-- Clear embeddings before DROP to avoid DuckDB WAL replay crash with FK refs.
-- Embeddings are recreated on next `context add` or `context refresh`.
DELETE FROM embeddings;
UPDATE context_items SET indexed_at = NULL;
DROP TABLE embeddings;
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  context_item_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_content TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_path TEXT,
  embedding FLOAT[1536],
  created_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  UNIQUE(context_item_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_cosine ON embeddings USING HNSW (embedding) WITH (metric = 'cosine');
CHECKPOINT;
