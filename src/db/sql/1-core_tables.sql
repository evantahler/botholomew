CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'failed', 'complete', 'waiting');

CREATE TABLE tasks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  name VARCHAR NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority task_priority NOT NULL DEFAULT 'medium',
  status task_status NOT NULL DEFAULT 'pending',
  waiting_reason TEXT,
  claimed_by VARCHAR,
  claimed_at TIMESTAMP,
  blocked_by VARCHAR[],
  context_ids VARCHAR[],
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE schedules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  name VARCHAR NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency VARCHAR NOT NULL,
  last_run_at TIMESTAMP,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE context_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  title VARCHAR NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT,
  content_blob BLOB,
  mime_type VARCHAR NOT NULL DEFAULT 'text/plain',
  is_textual BOOLEAN NOT NULL DEFAULT true,
  source_path VARCHAR,
  context_path VARCHAR NOT NULL,
  indexed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE embeddings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  context_item_id VARCHAR NOT NULL REFERENCES context_items(id),
  chunk_index INTEGER NOT NULL,
  chunk_content TEXT,
  title VARCHAR NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_path VARCHAR,
  embedding FLOAT[384],
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE(context_item_id, chunk_index)
);
