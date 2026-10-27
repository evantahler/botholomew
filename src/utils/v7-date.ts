/**
 * Helpers for deriving a UTC `YYYY-MM-DD` date string from a uuidv7 id.
 * Used by the threads store and the worker-log spawn path so file layouts
 * grouped by creation date can be computed without scanning the disk.
 */

/**
 * Format a Date as `YYYY-MM-DD` in UTC. UTC (not local time) keeps file
 * paths stable across machines and timezone moves: a thread created at
 * 11pm PT and read the next morning from a different zone resolves to
 * the same folder either way.
 */
export function utcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Recover the creation timestamp from a uuidv7. The first 48 bits of v7
 * are unix-millis. Returns null for non-v7 ids (or any parse failure) so
 * the caller can fall back — typically to a directory walk for reads, or
 * to "today" for writes.
 */
export function dateFromUuidV7(id: string): string | null {
  // shape: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx — the version nibble is
  // the 13th hex char (position 14 with the dash).
  if (id.length < 19 || id[14] !== "7") return null;
  const hex = id.slice(0, 8) + id.slice(9, 13);
  const ms = Number.parseInt(hex, 16);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return utcDateString(d);
}

/**
 * Best-effort: prefer the v7-derived date, else fall back to today's UTC.
 * Use for write paths where you have an id and need a concrete date dir.
 */
export function dateForId(id: string): string {
  return dateFromUuidV7(id) ?? utcDateString(new Date());
}

/** Regex that matches `YYYY-MM-DD` directory names. */
export const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
