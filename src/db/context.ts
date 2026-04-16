import type { DbConnection } from "./connection.ts";
import { buildSetClauses, buildWhereClause, sanitizeInt } from "./query.ts";
import { uuidv7 } from "./uuid.ts";

export interface ContextItem {
  id: string;
  title: string;
  description: string;
  content: string | null;
  mime_type: string;
  is_textual: boolean;
  source_path: string | null;
  context_path: string;
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
  source_path: string | null;
  context_path: string;
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
    source_path: row.source_path,
    context_path: row.context_path,
    indexed_at: row.indexed_at ? new Date(row.indexed_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// --- Basic CRUD ---

export async function createContextItem(
  db: DbConnection,
  params: {
    title: string;
    content?: string;
    mimeType?: string;
    sourcePath?: string;
    contextPath: string;
    description?: string;
    isTextual?: boolean;
  },
): Promise<ContextItem> {
  const id = uuidv7();
  const row = await db.queryGet<ContextItemRow>(
    `INSERT INTO context_items (id, title, description, content, mime_type, is_textual, source_path, context_path)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     RETURNING *`,
    id,
    params.title,
    params.description ?? "",
    params.content ?? null,
    params.mimeType ?? "text/plain",
    params.isTextual !== false,
    params.sourcePath ?? null,
    params.contextPath,
  );
  if (!row) throw new Error("INSERT did not return a row");
  return rowToContextItem(row);
}

export async function getContextItem(
  db: DbConnection,
  id: string,
): Promise<ContextItem | null> {
  const row = await db.queryGet<ContextItemRow>(
    "SELECT * FROM context_items WHERE id = ?1",
    id,
  );
  return row ? rowToContextItem(row) : null;
}

export async function getContextItemByPath(
  db: DbConnection,
  contextPath: string,
): Promise<ContextItem | null> {
  const row = await db.queryGet<ContextItemRow>(
    "SELECT * FROM context_items WHERE context_path = ?1",
    contextPath,
  );
  return row ? rowToContextItem(row) : null;
}

export async function listContextItems(
  db: DbConnection,
  filters?: {
    contextPath?: string;
    mimeType?: string;
    limit?: number;
    offset?: number;
  },
): Promise<ContextItem[]> {
  const { where, params } = buildWhereClause([
    ["context_path", filters?.contextPath],
    ["mime_type", filters?.mimeType],
  ]);
  const limit = filters?.limit ? `LIMIT ${sanitizeInt(filters.limit)}` : "";
  const offset = filters?.offset ? `OFFSET ${sanitizeInt(filters.offset)}` : "";

  const rows = await db.queryAll<ContextItemRow>(
    `SELECT * FROM context_items ${where} ORDER BY context_path ASC ${limit} ${offset}`,
    ...params,
  );
  return rows.map(rowToContextItem);
}

export async function listContextItemsByPrefix(
  db: DbConnection,
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
       WHERE context_path LIKE ?1
       ORDER BY context_path ASC ${limit} ${offset}`,
      `${normalizedPrefix}%`,
    );
  } else {
    // Only immediate children: match prefix but no further slashes
    rows = await db.queryAll<ContextItemRow>(
      `SELECT * FROM context_items
       WHERE context_path LIKE ?1
         AND context_path NOT LIKE ?2
       ORDER BY context_path ASC ${limit} ${offset}`,
      `${normalizedPrefix}%`,
      `${normalizedPrefix}%/%`,
    );
  }

  return rows.map(rowToContextItem);
}

export async function contextPathExists(
  db: DbConnection,
  contextPath: string,
): Promise<boolean> {
  const row = await db.queryGet(
    "SELECT 1 AS found FROM context_items WHERE context_path = ?1 LIMIT 1",
    contextPath,
  );
  return row != null;
}

export async function getDistinctDirectories(
  db: DbConnection,
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
          WHEN strpos(substr(context_path, length(?1) + 1), '/') > 0
          THEN substr(substr(context_path, length(?1) + 1), 1, strpos(substr(context_path, length(?1) + 1), '/') - 1)
          ELSE substr(context_path, length(?1) + 1)
        END AS dir
      FROM context_items
      WHERE context_path LIKE ?2
      ORDER BY dir ASC`,
    normalizedPrefix,
    `${normalizedPrefix}%/%`,
  );

  return rows.map((row) => row.dir);
}

// --- Mutations ---

export async function updateContextItem(
  db: DbConnection,
  id: string,
  updates: Partial<
    Pick<ContextItem, "title" | "description" | "content" | "mime_type">
  >,
): Promise<ContextItem | null> {
  const { setClauses, params } = buildSetClauses([
    ["title", updates.title],
    ["description", updates.description],
    ["content", updates.content],
    ["mime_type", updates.mime_type],
  ]);

  setClauses.push("updated_at = current_timestamp::VARCHAR");
  params.push(id);

  const row = await db.queryGet<ContextItemRow>(
    `UPDATE context_items
     SET ${setClauses.join(", ")}
     WHERE id = ?${params.length}
     RETURNING *`,
    ...params,
  );
  return row ? rowToContextItem(row) : null;
}

export async function updateContextItemContent(
  db: DbConnection,
  contextPath: string,
  content: string,
): Promise<ContextItem | null> {
  const row = await db.queryGet<ContextItemRow>(
    `UPDATE context_items
     SET content = ?1, updated_at = current_timestamp::VARCHAR
     WHERE context_path = ?2
     RETURNING *`,
    content,
    contextPath,
  );
  return row ? rowToContextItem(row) : null;
}

export async function applyPatchesToContextItem(
  db: DbConnection,
  contextPath: string,
  patches: Patch[],
): Promise<{ item: ContextItem; applied: number }> {
  const item = await getContextItemByPath(db, contextPath);
  if (!item) throw new Error(`Not found: ${contextPath}`);
  if (item.content == null) throw new Error(`No text content: ${contextPath}`);

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
  const updated = await updateContextItemContent(db, contextPath, newContent);
  if (!updated) throw new Error(`Failed to update: ${contextPath}`);
  return { item: updated, applied: patches.length };
}

export async function copyContextItem(
  db: DbConnection,
  srcPath: string,
  dstPath: string,
): Promise<ContextItem> {
  const src = await getContextItemByPath(db, srcPath);
  if (!src) throw new Error(`Not found: ${srcPath}`);

  return createContextItem(db, {
    title: src.title,
    description: src.description,
    content: src.content ?? undefined,
    mimeType: src.mime_type,
    sourcePath: src.source_path ?? undefined,
    contextPath: dstPath,
    isTextual: src.is_textual,
  });
}

export async function moveContextItem(
  db: DbConnection,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const row = await db.queryGet(
    `UPDATE context_items
     SET context_path = ?1, updated_at = current_timestamp::VARCHAR
     WHERE context_path = ?2
     RETURNING id`,
    newPath,
    oldPath,
  );
  if (!row) {
    throw new Error(`Not found: ${oldPath}`);
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
  contextPath: string,
): Promise<boolean> {
  // Get ID first so we can cascade embeddings
  const item = await getContextItemByPath(db, contextPath);
  if (!item) return false;
  return deleteContextItem(db, item.id);
}

export async function deleteContextItemsByPrefix(
  db: DbConnection,
  prefix: string,
): Promise<number> {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  // Delete embeddings for all matching items
  await db.queryRun(
    `DELETE FROM embeddings
     WHERE context_item_id IN (
       SELECT id FROM context_items
       WHERE context_path LIKE ?1
     )`,
    `${normalizedPrefix}%`,
  );

  const rows = await db.queryAll(
    `DELETE FROM context_items
     WHERE context_path LIKE ?1
     RETURNING id`,
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
