import { resolve as resolvePath } from "node:path";
import {
  type DriveTarget,
  formatDriveRef,
  parseDriveRef,
} from "../context/drives.ts";
import type { DbConnection } from "./connection.ts";
import { buildSetClauses, buildWhereClause, sanitizeInt } from "./query.ts";
import { isUuid, uuidv7 } from "./uuid.ts";

export interface ContextItem {
  id: string;
  title: string;
  description: string;
  content: string | null;
  mime_type: string;
  is_textual: boolean;
  drive: string;
  path: string;
  source_url: string | null;
  indexed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Patch {
  start_line: number;
  end_line: number;
  content: string;
}

interface ContextItemRow {
  id: string;
  title: string;
  description: string;
  content: string | null;
  content_blob: unknown;
  mime_type: string;
  is_textual: boolean;
  drive: string;
  path: string;
  source_url: string | null;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToContextItem(row: ContextItemRow): ContextItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    mime_type: row.mime_type,
    is_textual: !!row.is_textual,
    drive: row.drive,
    path: row.path,
    source_url: row.source_url,
    indexed_at: row.indexed_at ? new Date(row.indexed_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export class PathConflictError extends Error {
  existingId: string;
  drive: string;
  path: string;
  constructor(existingId: string, target: DriveTarget) {
    super(`Path already exists: ${formatDriveRef(target)}`);
    this.name = "PathConflictError";
    this.existingId = existingId;
    this.drive = target.drive;
    this.path = target.path;
  }
}

// --- Basic CRUD ---

export async function createContextItem(
  db: DbConnection,
  params: {
    title: string;
    content?: string;
    mimeType?: string;
    drive: string;
    path: string;
    description?: string;
    isTextual?: boolean;
    sourceUrl?: string | null;
  },
): Promise<ContextItem> {
  const id = uuidv7();
  const row = await db.queryGet<ContextItemRow>(
    `INSERT INTO context_items (id, title, description, content, mime_type, is_textual, drive, path, source_url)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     RETURNING *`,
    id,
    params.title,
    params.description ?? "",
    params.content ?? null,
    params.mimeType ?? "text/plain",
    params.isTextual !== false,
    params.drive,
    params.path,
    params.sourceUrl ?? null,
  );
  if (!row) throw new Error("INSERT did not return a row");
  return rowToContextItem(row);
}

/**
 * Atomic upsert by (drive, path): updates if the pair exists, inserts otherwise.
 *
 * DuckDB implements UPDATE as delete+insert on tables with unique indexes,
 * which violates foreign keys from the embeddings table. We must delete
 * embeddings before updating; callers (context add, context_write) re-create
 * them in their ingestion phase.
 */
export async function upsertContextItem(
  db: DbConnection,
  params: {
    title: string;
    content?: string;
    mimeType?: string;
    drive: string;
    path: string;
    description?: string;
    isTextual?: boolean;
    sourceUrl?: string | null;
  },
): Promise<ContextItem> {
  const existing = await getContextItem(db, {
    drive: params.drive,
    path: params.path,
  });
  if (existing) {
    const updated = await updateContextItem(db, existing.id, {
      title: params.title,
      content: params.content,
      mime_type: params.mimeType,
      source_url: params.sourceUrl,
    });
    if (!updated)
      throw new Error(
        `Failed to update: ${formatDriveRef({ drive: params.drive, path: params.path })}`,
      );
    return updated;
  }
  return createContextItem(db, params);
}

/**
 * Strict creator: throws PathConflictError if (drive, path) already exists.
 * Use when callers want to surface collisions instead of silently overwriting.
 */
export async function createContextItemStrict(
  db: DbConnection,
  params: {
    title: string;
    content?: string;
    mimeType?: string;
    drive: string;
    path: string;
    description?: string;
    isTextual?: boolean;
    sourceUrl?: string | null;
  },
): Promise<ContextItem> {
  const existing = await getContextItem(db, {
    drive: params.drive,
    path: params.path,
  });
  if (existing)
    throw new PathConflictError(existing.id, {
      drive: params.drive,
      path: params.path,
    });
  return createContextItem(db, params);
}

export async function getContextItemById(
  db: DbConnection,
  id: string,
): Promise<ContextItem | null> {
  const row = await db.queryGet<ContextItemRow>(
    "SELECT * FROM context_items WHERE id = ?1",
    id,
  );
  return row ? rowToContextItem(row) : null;
}

export async function getContextItem(
  db: DbConnection,
  target: DriveTarget,
): Promise<ContextItem | null> {
  const row = await db.queryGet<ContextItemRow>(
    "SELECT * FROM context_items WHERE drive = ?1 AND path = ?2",
    target.drive,
    target.path,
  );
  return row ? rowToContextItem(row) : null;
}

/**
 * Look up a context item by UUID, `drive:/path`, or bare filesystem path
 * (resolved against cwd and treated as `disk:/...`).
 *
 * The bare-path fallback lets users pass the same argument they used for
 * `context add` (e.g. a relative `README.md`) to management commands like
 * `context refresh` / `context chunks`.
 */
export async function resolveContextItem(
  db: DbConnection,
  ref: string,
): Promise<ContextItem | null> {
  if (isUuid(ref)) return getContextItemById(db, ref);

  const parsed = parseDriveRef(ref);
  if (parsed) return getContextItem(db, parsed);

  // Bare filesystem path — try the `disk` drive with an absolute path.
  const absolute = resolvePath(ref);
  return getContextItem(db, { drive: "disk", path: absolute });
}

/**
 * Like resolveContextItem but throws if not found.
 */
export async function resolveContextItemOrThrow(
  db: DbConnection,
  ref: string,
): Promise<ContextItem> {
  const item = await resolveContextItem(db, ref);
  if (!item) throw new Error(`Not found: ${ref}`);
  return item;
}

export interface NearbyContextPaths {
  /** Directory we found neighbours under (may be an ancestor if the direct parent was empty). */
  parent: string;
  /** Exact `drive:/path` values of the parent's immediate children. */
  siblings: string[];
  /** True if we walked up from the requested path's direct parent to find a populated ancestor. */
  walkedUp: boolean;
}

/**
 * Find context items near a requested path to power "did you mean?" suggestions
 * when a lookup misses. Returns up to `limit` immediate neighbours within the
 * same drive; if the parent has no rows, walks up until it finds a populated
 * ancestor (or hits root).
 */
export async function findNearbyContextPaths(
  db: DbConnection,
  drive: string,
  requestedPath: string,
  limit = 5,
): Promise<NearbyContextPaths> {
  let parent = parentDir(requestedPath);
  let walkedUp = false;
  while (true) {
    const items = await listContextItemsByPrefix(db, drive, parent, {
      recursive: false,
      limit,
    });
    if (items.length > 0 || parent === "/") {
      return {
        parent: `${drive}:${parent}`,
        siblings: items.map((i) => formatDriveRef(i)),
        walkedUp,
      };
    }
    parent = parentDir(parent);
    walkedUp = true;
  }
}

function parentDir(p: string): string {
  if (!p || p === "/") return "/";
  const trimmed = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

export async function listContextItems(
  db: DbConnection,
  filters?: {
    drive?: string;
    mimeType?: string;
    limit?: number;
    offset?: number;
  },
): Promise<ContextItem[]> {
  const { where, params } = buildWhereClause([
    ["drive", filters?.drive],
    ["mime_type", filters?.mimeType],
  ]);
  const limit = filters?.limit ? `LIMIT ${sanitizeInt(filters.limit)}` : "";
  const offset = filters?.offset ? `OFFSET ${sanitizeInt(filters.offset)}` : "";

  const rows = await db.queryAll<ContextItemRow>(
    `SELECT * FROM context_items ${where} ORDER BY drive ASC, path ASC, id ASC ${limit} ${offset}`,
    ...params,
  );
  return rows.map(rowToContextItem);
}

export async function listContextItemsByPrefix(
  db: DbConnection,
  drive: string,
  prefix: string,
  opts?: { recursive?: boolean; limit?: number; offset?: number },
): Promise<ContextItem[]> {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  const limit = opts?.limit ? `LIMIT ${sanitizeInt(opts.limit)}` : "";
  const offset = opts?.offset ? `OFFSET ${sanitizeInt(opts.offset)}` : "";

  let rows: ContextItemRow[];
  if (opts?.recursive) {
    rows = await db.queryAll<ContextItemRow>(
      `SELECT * FROM context_items
       WHERE drive = ?1 AND path LIKE ?2
       ORDER BY path ASC, id ASC ${limit} ${offset}`,
      drive,
      `${normalizedPrefix}%`,
    );
  } else {
    rows = await db.queryAll<ContextItemRow>(
      `SELECT * FROM context_items
       WHERE drive = ?1 AND path LIKE ?2
         AND path NOT LIKE ?3
       ORDER BY path ASC, id ASC ${limit} ${offset}`,
      drive,
      `${normalizedPrefix}%`,
      `${normalizedPrefix}%/%`,
    );
  }

  return rows.map(rowToContextItem);
}

export async function contextPathExists(
  db: DbConnection,
  target: DriveTarget,
): Promise<boolean> {
  const row = await db.queryGet(
    "SELECT 1 AS found FROM context_items WHERE drive = ?1 AND path = ?2 LIMIT 1",
    target.drive,
    target.path,
  );
  return row != null;
}

export async function countContextItemsByPrefix(
  db: DbConnection,
  drive: string,
  prefix: string,
  opts?: { recursive?: boolean },
): Promise<number> {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  let row: { cnt: number } | null;
  if (opts?.recursive !== false) {
    row = await db.queryGet<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM context_items WHERE drive = ?1 AND path LIKE ?2`,
      drive,
      `${normalizedPrefix}%`,
    );
  } else {
    row = await db.queryGet<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM context_items
       WHERE drive = ?1 AND path LIKE ?2 AND path NOT LIKE ?3`,
      drive,
      `${normalizedPrefix}%`,
      `${normalizedPrefix}%/%`,
    );
  }
  return row ? Number(row.cnt) : 0;
}

export async function getDistinctDirectories(
  db: DbConnection,
  drive: string,
  prefix?: string,
): Promise<string[]> {
  const normalizedPrefix = prefix
    ? prefix.endsWith("/")
      ? prefix
      : `${prefix}/`
    : "/";

  // Extract the first path segment after the prefix
  const rows = await db.queryAll<{ dir: string }>(
    `SELECT DISTINCT
        ?1 || CASE
          WHEN strpos(substr(path, length(?1) + 1), '/') > 0
          THEN substr(substr(path, length(?1) + 1), 1, strpos(substr(path, length(?1) + 1), '/') - 1)
          ELSE substr(path, length(?1) + 1)
        END AS dir
      FROM context_items
      WHERE drive = ?2 AND path LIKE ?3
      ORDER BY dir ASC`,
    normalizedPrefix,
    drive,
    `${normalizedPrefix}%/%`,
  );

  return rows.map((row) => row.dir);
}

export interface DriveSummary {
  drive: string;
  count: number;
}

export async function listDriveSummaries(
  db: DbConnection,
): Promise<DriveSummary[]> {
  const rows = await db.queryAll<{ drive: string; cnt: number }>(
    "SELECT drive, COUNT(*) AS cnt FROM context_items GROUP BY drive ORDER BY drive ASC",
  );
  return rows.map((r) => ({ drive: r.drive, count: Number(r.cnt) }));
}

// --- Mutations ---

// `UPDATE context_items ... RETURNING *` can crash @duckdb/node-api via a C++
// exception when the table's unique index is in a violated state. Update +
// separate SELECT is equivalent here (single-connection, no concurrent writers)
// and avoids the crash entirely.
export async function updateContextItem(
  db: DbConnection,
  id: string,
  updates: Partial<
    Pick<
      ContextItem,
      "title" | "description" | "content" | "mime_type" | "source_url"
    >
  >,
): Promise<ContextItem | null> {
  const { setClauses, params } = buildSetClauses([
    ["title", updates.title],
    ["description", updates.description],
    ["content", updates.content],
    ["mime_type", updates.mime_type],
    ["source_url", updates.source_url],
  ]);

  setClauses.push("updated_at = current_timestamp::VARCHAR");
  params.push(id);

  await db.queryRun(
    `UPDATE context_items
     SET ${setClauses.join(", ")}
     WHERE id = ?${params.length}`,
    ...params,
  );
  return getContextItemById(db, id);
}

export async function updateContextItemContent(
  db: DbConnection,
  target: DriveTarget,
  content: string,
): Promise<ContextItem | null> {
  await db.queryRun(
    `UPDATE context_items
     SET content = ?1, updated_at = current_timestamp::VARCHAR
     WHERE drive = ?2 AND path = ?3`,
    content,
    target.drive,
    target.path,
  );
  return getContextItem(db, target);
}

export async function applyPatchesToContextItem(
  db: DbConnection,
  target: DriveTarget,
  patches: Patch[],
): Promise<{ item: ContextItem; applied: number }> {
  const item = await getContextItem(db, target);
  if (!item) throw new Error(`Not found: ${formatDriveRef(target)}`);
  if (item.content == null)
    throw new Error(`No text content: ${formatDriveRef(target)}`);

  const lines = item.content.split("\n");

  // Sort patches by start_line descending so we apply bottom-up
  const sorted = [...patches].sort((a, b) => b.start_line - a.start_line);

  for (const patch of sorted) {
    if (patch.end_line === 0) {
      // Insert at start_line without replacing
      const insertLines = patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, 0, ...insertLines);
    } else {
      // Replace lines [start_line, end_line] inclusive (1-based)
      const deleteCount = patch.end_line - patch.start_line + 1;
      const insertLines = patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, deleteCount, ...insertLines);
    }
  }

  const newContent = lines.join("\n");
  const updated = await updateContextItemContent(db, target, newContent);
  if (!updated) throw new Error(`Failed to update: ${formatDriveRef(target)}`);
  return { item: updated, applied: patches.length };
}

export async function copyContextItem(
  db: DbConnection,
  src: DriveTarget,
  dst: DriveTarget,
): Promise<ContextItem> {
  const source = await getContextItem(db, src);
  if (!source) throw new Error(`Not found: ${formatDriveRef(src)}`);

  return createContextItem(db, {
    title: source.title,
    description: source.description,
    content: source.content ?? undefined,
    mimeType: source.mime_type,
    drive: dst.drive,
    path: dst.path,
    isTextual: source.is_textual,
    sourceUrl: source.source_url,
  });
}

export async function moveContextItem(
  db: DbConnection,
  src: DriveTarget,
  dst: DriveTarget,
): Promise<void> {
  const row = await db.queryGet(
    `UPDATE context_items
     SET drive = ?1, path = ?2, updated_at = current_timestamp::VARCHAR
     WHERE drive = ?3 AND path = ?4
     RETURNING id`,
    dst.drive,
    dst.path,
    src.drive,
    src.path,
  );
  if (!row) {
    throw new Error(`Not found: ${formatDriveRef(src)}`);
  }
}

// --- Deletion ---

export async function deleteContextItem(
  db: DbConnection,
  id: string,
): Promise<boolean> {
  // Delete embeddings first (foreign key)
  await db.queryRun("DELETE FROM embeddings WHERE context_item_id = ?1", id);
  const row = await db.queryGet(
    "DELETE FROM context_items WHERE id = ?1 RETURNING id",
    id,
  );
  return row != null;
}

export async function deleteContextItemByPath(
  db: DbConnection,
  target: DriveTarget,
): Promise<boolean> {
  const item = await getContextItem(db, target);
  if (!item) return false;
  return deleteContextItem(db, item.id);
}

export async function deleteAllContextItems(
  db: DbConnection,
): Promise<{ contextItems: number; embeddings: number }> {
  const embeddings = await db.queryRun("DELETE FROM embeddings");
  const contextItems = await db.queryRun("DELETE FROM context_items");
  return {
    contextItems: contextItems.changes,
    embeddings: embeddings.changes,
  };
}

export async function deleteContextItemsByPrefix(
  db: DbConnection,
  drive: string,
  prefix: string,
): Promise<number> {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  // Delete embeddings for all matching items
  await db.queryRun(
    `DELETE FROM embeddings
     WHERE context_item_id IN (
       SELECT id FROM context_items
       WHERE drive = ?1 AND path LIKE ?2
     )`,
    drive,
    `${normalizedPrefix}%`,
  );

  const rows = await db.queryAll(
    `DELETE FROM context_items
     WHERE drive = ?1 AND path LIKE ?2
     RETURNING id`,
    drive,
    `${normalizedPrefix}%`,
  );
  return rows.length;
}

// --- Search ---

export async function searchContextByKeyword(
  db: DbConnection,
  query: string,
  limit = 20,
): Promise<ContextItem[]> {
  const pattern = `%${query}%`;
  const rows = await db.queryAll<ContextItemRow>(
    `SELECT * FROM context_items
     WHERE content IS NOT NULL
       AND (
         content ILIKE ?1
         OR title ILIKE ?1
       )
     ORDER BY updated_at DESC
     LIMIT ?2`,
    pattern,
    limit,
  );
  return rows.map(rowToContextItem);
}
