-- HNSW has caused two separate corruption modes in this project: the
-- "Duplicate keys not allowed in high-level wrappers" failure addressed by
-- migration 11, and a second mode where the index silently returns zero rows
-- for cosine top-K queries (its stored SQL loses the `WITH (metric = 'cosine')`
-- clause). At our scale a linear scan of array_cosine_distance is plenty fast
-- and array_cosine_distance is a core DuckDB function — no VSS extension
-- required. Drop the index and move on.
DROP INDEX IF EXISTS idx_embeddings_cosine;
