CREATE TABLE daemon_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR)
);