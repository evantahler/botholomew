CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'failed', 'complete', 'waiting')),
  waiting_reason TEXT,
  claimed_by TEXT,
  claimed_at TEXT,
  blocked_by TEXT NOT NULL DEFAULT '[]',
  context_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL,
  last_run_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE context_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT,
  content_blob BLOB,
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  is_textual INTEGER NOT NULL DEFAULT 1,
  source_path TEXT,
  context_path TEXT NOT NULL,
  indexed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  context_item_id TEXT NOT NULL REFERENCES context_items(id),
  chunk_index INTEGER NOT NULL,
  chunk_content TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_path TEXT,
  embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(context_item_id, chunk_index)
);
