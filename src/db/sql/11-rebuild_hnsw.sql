-- The HNSW index from migration 6 can end up in an internally-inconsistent
-- state after a native-side crash during embedding writes: the buffered WAL
-- replay tries to re-insert a node that HNSW's high-level wrapper already has,
-- and search_semantic then fails with "Duplicate keys not allowed in
-- high-level wrappers". Dropping and recreating the index rebuilds it cleanly
-- from the current contents of the embeddings table.
DROP INDEX IF EXISTS idx_embeddings_cosine;

CREATE INDEX idx_embeddings_cosine ON embeddings USING HNSW (embedding) WITH (metric = 'cosine');
