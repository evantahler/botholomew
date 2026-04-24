-- Historical: this migration used to CREATE an HNSW index on embeddings
-- via the VSS extension. HNSW has since been removed (see migration 12)
-- (see migration 14) and the VSS extension is no longer loaded at
-- connection time, so running `CREATE INDEX ... USING HNSW` here would
-- fail on fresh DBs. Kept as a no-op to preserve migration numbering
-- for existing databases that have already recorded id 6 in _migrations.
SELECT 1;
