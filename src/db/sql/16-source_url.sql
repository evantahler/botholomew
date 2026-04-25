-- Issue #145: preserve the original URL that produced each context item so
-- `context refresh` can re-fetch loss-lessly for service-specific drives
-- (google-docs, github, ...). Nullable — local-origin drives (disk, agent,
-- tool writes) leave it NULL and use their own refresh path. Legacy rows
-- ingested before this column existed also leave it NULL and surface a
-- "re-add from URL" error on refresh.
ALTER TABLE context_items ADD COLUMN source_url TEXT;
