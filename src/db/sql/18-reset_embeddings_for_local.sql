-- Switch from OpenAI 1536-dim embeddings to local 384-dim embeddings.
--
-- DuckDB encodes array dimension in the column type, so we rebuild the
-- embeddings table preserving every row's metadata (chunk_content, title,
-- description, context_item_id, chunk_index, created_at). The vectors
-- themselves are NULLed and repopulated by `botholomew context reembed`
-- using the locally-loaded embedding model.
--
-- Idempotency: every destructive step uses IF EXISTS so a partial prior
-- run can be re-attempted cleanly. The FTS index is dropped here but NOT
-- recreated — `migrate()` calls rebuildSearchIndex once after all SQL
-- migrations apply, which avoids a same-migration drop-then-create that
-- DuckDB rejects with "Could not commit creation of dependency, subject
-- 'stopwords' has been deleted".

DROP SCHEMA IF EXISTS fts_main_embeddings CASCADE;

DROP TABLE IF EXISTS embeddings_new;

CREATE TABLE embeddings_new (
  id TEXT PRIMARY KEY,
  context_item_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_content TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  embedding FLOAT[384],
  created_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  UNIQUE(context_item_id, chunk_index)
);

INSERT INTO embeddings_new (id, context_item_id, chunk_index, chunk_content, title, description, embedding, created_at)
SELECT id, context_item_id, chunk_index, chunk_content, title, description, NULL, created_at
FROM embeddings;

DROP TABLE embeddings;
ALTER TABLE embeddings_new RENAME TO embeddings;

CHECKPOINT;
