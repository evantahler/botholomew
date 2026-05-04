-- Switch the search index from "tracks DuckDB-backed virtual files" to
-- "tracks real files on disk under context/", and drop every table whose
-- contents now live on the filesystem (tasks, schedules) or that nothing
-- writes to anymore (daemon_state). The remaining DuckDB tables are:
--   workers, threads, interactions, context_index, _migrations
--
-- A new `context_index` table holds one row per (path, chunk_index), with a
-- file-level content hash + mtime so `botholomew context reindex` can detect
-- adds, updates, and removals in one pass.
--
-- Idempotent: every step uses IF EXISTS so a partial prior run is safe to
-- re-attempt. The FTS index over the new chunk_content column is created by
-- migrate() via rebuildSearchIndex() after all migrations apply.

DROP SCHEMA IF EXISTS fts_main_embeddings CASCADE;
DROP TABLE IF EXISTS embeddings;
DROP TABLE IF EXISTS context_items;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS daemon_state;

CREATE TABLE IF NOT EXISTS context_index (
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_content TEXT NOT NULL,
  embedding FLOAT[384],
  mtime_ms BIGINT NOT NULL,
  size_bytes BIGINT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  PRIMARY KEY (path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_context_index_path ON context_index(path);

CHECKPOINT;
