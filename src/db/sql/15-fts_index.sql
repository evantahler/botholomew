-- Keyword search uses DuckDB's FTS extension for BM25 ranking over
-- chunk_content and title. The index is a snapshot and must be rebuilt
-- after any write to the embeddings table. rebuildSearchIndex() in
-- src/db/embeddings.ts is the single entry point and is called from the
-- ingest transaction. overwrite = 1 makes this PRAGMA idempotent, which
-- also gives us a first-run rebuild for users upgrading from a DB that
-- never had FTS.
PRAGMA create_fts_index('embeddings', 'id', 'chunk_content', 'title', overwrite = 1);
