CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('daemon_tick', 'chat_session')),
  task_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  metadata TEXT
);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  kind TEXT NOT NULL CHECK(kind IN ('message', 'thinking', 'tool_use', 'tool_result', 'context_update', 'status_change')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  duration_ms INTEGER,
  token_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(thread_id, sequence)
);
