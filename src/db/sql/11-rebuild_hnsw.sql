-- Historical: this migration used to drop and recreate the HNSW index
-- to clean up an internally-inconsistent state after native-side crashes
-- during embedding writes. HNSW is now gone (see migration 14) and the
-- VSS extension is no longer loaded at connection time, so the original
-- DDL would fail on fresh DBs. Kept as a no-op to preserve migration
-- numbering for existing databases that have already recorded id 11 in
-- _migrations.
SELECT 1;
