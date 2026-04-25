-- Per-worker log file path. NULL for foreground / in-process workers that
-- write to stdout instead of a dedicated file.
ALTER TABLE workers ADD COLUMN log_path TEXT;
