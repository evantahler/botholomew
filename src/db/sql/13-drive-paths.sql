-- Milestone 10: collapse `source_path` + `context_path` + `source_type` into a
-- single `(drive, path)` identity pair. Pre-1.0, no backwards-compat promise —
-- we wipe context_items + embeddings and have the user re-add their content.
--
-- DuckDB's ALTER TABLE support is thin (no SET NOT NULL, flaky DROP COLUMN with
-- existing indexes), so this is a table rebuild. Order matters: drop indexes
-- first, then the old tables, then recreate with the new shape.

DELETE FROM embeddings;
DELETE FROM context_items;

DROP INDEX IF EXISTS idx_embeddings_cosine;
DROP INDEX IF EXISTS idx_context_items_context_path;

DROP TABLE embeddings;
DROP TABLE context_items;

CREATE TABLE context_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT,
  content_blob BLOB,
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  is_textual BOOLEAN NOT NULL DEFAULT true,
  drive TEXT NOT NULL,
  path TEXT NOT NULL,
  indexed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR)
);

CREATE UNIQUE INDEX idx_context_items_drive_path ON context_items(drive, path);

CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  context_item_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_content TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  embedding FLOAT[1536],
  created_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  UNIQUE(context_item_id, chunk_index)
);

CREATE INDEX idx_embeddings_cosine ON embeddings USING HNSW (embedding) WITH (metric = 'cosine');

CHECKPOINT;
