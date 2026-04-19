-- Worker agents: replaces the PID-file + OS-watchdog single-daemon model
-- with multiple in-DB registered workers that heartbeat and can be reaped.

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('persist', 'once')),
  task_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'stopped', 'dead')),
  started_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  last_heartbeat_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  stopped_at TEXT
);

CREATE INDEX idx_workers_status_heartbeat ON workers(status, last_heartbeat_at);

-- Schedule claim columns: only one worker evaluates a schedule per window.
ALTER TABLE schedules ADD COLUMN claimed_by TEXT;
ALTER TABLE schedules ADD COLUMN claimed_at TEXT;

-- Rewrite threads.type values: daemon_tick → worker_tick. The existing
-- CHECK constraint forbids the new value, so we rebuild both threads and
-- interactions (whose FK to threads would block a DROP). Dropping the FK
-- follows the 7-drop_embeddings_fk.sql precedent.
CREATE TABLE threads_backup AS SELECT * FROM threads;
CREATE TABLE interactions_backup AS SELECT * FROM interactions;

DROP TABLE interactions;
DROP TABLE threads;

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('worker_tick', 'chat_session')),
  task_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  ended_at TEXT,
  metadata TEXT
);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  kind TEXT NOT NULL CHECK(kind IN ('message', 'thinking', 'tool_use', 'tool_result', 'context_update', 'status_change')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  duration_ms INTEGER,
  token_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  UNIQUE(thread_id, sequence)
);

INSERT INTO threads
SELECT id,
       CASE WHEN type = 'daemon_tick' THEN 'worker_tick' ELSE type END,
       task_id, title, started_at, ended_at, metadata
FROM threads_backup;

INSERT INTO interactions SELECT * FROM interactions_backup;

DROP TABLE threads_backup;
DROP TABLE interactions_backup;
