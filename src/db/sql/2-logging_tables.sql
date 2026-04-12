CREATE TYPE thread_type AS ENUM ('daemon_tick', 'chat_session');
CREATE TYPE interaction_role AS ENUM ('user', 'assistant', 'system', 'tool');
CREATE TYPE interaction_kind AS ENUM (
  'message',
  'thinking',
  'tool_use',
  'tool_result',
  'context_update',
  'status_change'
);

CREATE TABLE threads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  type thread_type NOT NULL,
  task_id VARCHAR,
  title VARCHAR NOT NULL DEFAULT '',
  started_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  ended_at TIMESTAMP,
  metadata TEXT
);

CREATE TABLE interactions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  thread_id VARCHAR NOT NULL REFERENCES threads(id),
  sequence INTEGER NOT NULL,
  role interaction_role NOT NULL,
  kind interaction_kind NOT NULL,
  content TEXT NOT NULL,
  tool_name VARCHAR,
  tool_input TEXT,
  duration_ms INTEGER,
  token_count INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE(thread_id, sequence)
);
