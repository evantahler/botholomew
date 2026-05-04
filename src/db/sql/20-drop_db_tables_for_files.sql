-- Tasks, schedules, threads, interactions, and workers all moved out of
-- DuckDB onto disk:
--   tasks/             markdown files with frontmatter (one per task)
--   schedules/         markdown files with frontmatter (one per schedule)
--   context/threads/   CSV per conversation (searchable via the index)
--   workers/           JSON pidfile per worker, mtime-checked heartbeats
--
-- The only remaining DuckDB objects after this migration are _migrations,
-- context_index, and the FTS index built over context_index by
-- rebuildSearchIndex(). Idempotent via IF EXISTS.

DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS workers;

DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS schedules;

CHECKPOINT;
