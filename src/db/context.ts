import type { DuckDBConnection } from "./connection.ts";

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

function rowToContextItem(row: unknown[]): ContextItem {
  return {
    id: String(row[0]),
    title: String(row[1]),
    description: String(row[2]),
    content: row[3] != null ? String(row[3]) : null,
    // skip content_blob (row[4])
    mime_type: String(row[5]),
    is_textual: Boolean(row[6]),
    source_path: row[7] != null ? String(row[7]) : null,
    context_path: String(row[8]),
    indexed_at: row[9] != null ? new Date(String(row[9])) : null,
    created_at: new Date(String(row[10])),
    updated_at: new Date(String(row[11])),
  };
}

function escape(str: string): string {
  return str.replace(/'/g, "''");
}

// --- Basic CRUD ---

export async function createContextItem(
  conn: DuckDBConnection,
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
  const result = await conn.runAndReadAll(`
    INSERT INTO context_items (title, description, content, mime_type, is_textual, source_path, context_path)
    VALUES (
      '${escape(params.title)}',
      '${escape(params.description ?? "")}',
      ${params.content != null ? `'${escape(params.content)}'` : "NULL"},
      '${escape(params.mimeType ?? "text/plain")}',
      ${params.isTextual !== false},
      ${params.sourcePath != null ? `'${escape(params.sourcePath)}'` : "NULL"},
      '${escape(params.contextPath)}'
    )
    RETURNING *
  `);
  return rowToContextItem(result.getRows()[0]!);
}

export async function getContextItem(
  conn: DuckDBConnection,
  id: string,
): Promise<ContextItem | null> {
  const result = await conn.runAndReadAll(
    `SELECT * FROM context_items WHERE id = '${escape(id)}'`,
  );
  const rows = result.getRows();
  return rows.length > 0 ? rowToContextItem(rows[0]!) : null;
}

export async function getContextItemByPath(
  conn: DuckDBConnection,
  contextPath: string,
): Promise<ContextItem | null> {
  const result = await conn.runAndReadAll(
    `SELECT * FROM context_items WHERE context_path = '${escape(contextPath)}'`,
  );
  const rows = result.getRows();
  return rows.length > 0 ? rowToContextItem(rows[0]!) : null;
}

export async function listContextItems(
  conn: DuckDBConnection,
  filters?: {
    contextPath?: string;
    mimeType?: string;
    limit?: number;
  },
): Promise<ContextItem[]> {
  const conditions: string[] = [];
  if (filters?.contextPath)
    conditions.push(`context_path = '${escape(filters.contextPath)}'`);
  if (filters?.mimeType)
    conditions.push(`mime_type = '${escape(filters.mimeType)}'`);

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ? `LIMIT ${filters.limit}` : "";

  const result = await conn.runAndReadAll(
    `SELECT * FROM context_items ${where} ORDER BY context_path ASC ${limit}`,
  );
  return result.getRows().map(rowToContextItem);
}

export async function listContextItemsByPrefix(
  conn: DuckDBConnection,
  prefix: string,
  opts?: { recursive?: boolean; limit?: number },
): Promise<ContextItem[]> {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  let where: string;
  if (opts?.recursive) {
    // All items under this prefix at any depth
    where = `WHERE context_path LIKE '${escape(normalizedPrefix)}%'`;
  } else {
    // Only immediate children: match prefix but no further slashes
    where = `WHERE context_path LIKE '${escape(normalizedPrefix)}%'
      AND context_path NOT LIKE '${escape(normalizedPrefix)}%/%'`;
  }

  const limit = opts?.limit ? `LIMIT ${opts.limit}` : "";

  const result = await conn.runAndReadAll(
    `SELECT * FROM context_items ${where} ORDER BY context_path ASC ${limit}`,
  );
  return result.getRows().map(rowToContextItem);
}

export async function contextPathExists(
  conn: DuckDBConnection,
  contextPath: string,
): Promise<boolean> {
  const result = await conn.runAndReadAll(
    `SELECT 1 FROM context_items WHERE context_path = '${escape(contextPath)}' LIMIT 1`,
  );
  return result.getRows().length > 0;
}

export async function getDistinctDirectories(
  conn: DuckDBConnection,
  prefix?: string,
): Promise<string[]> {
  const normalizedPrefix = prefix
    ? prefix.endsWith("/")
      ? prefix
      : `${prefix}/`
    : "/";

  // Extract the directory portion after the prefix, taking only the first path segment
  const where = prefix
    ? `WHERE context_path LIKE '${escape(normalizedPrefix)}%/%'`
    : `WHERE context_path LIKE '%/%'`;

  const result = await conn.runAndReadAll(`
    SELECT DISTINCT
      '${escape(normalizedPrefix)}' || split_part(
        substr(context_path, length('${escape(normalizedPrefix)}') + 1),
        '/',
        1
      ) AS dir
    FROM context_items
    ${where}
    ORDER BY dir ASC
  `);

  return result.getRows().map((row) => String(row[0]));
}

// --- Mutations ---

export async function updateContextItem(
  conn: DuckDBConnection,
  id: string,
  updates: Partial<
    Pick<ContextItem, "title" | "description" | "content" | "mime_type">
  >,
): Promise<ContextItem | null> {
  const setClauses: string[] = ["updated_at = current_timestamp"];
  if (updates.title !== undefined)
    setClauses.push(`title = '${escape(updates.title)}'`);
  if (updates.description !== undefined)
    setClauses.push(`description = '${escape(updates.description)}'`);
  if (updates.content !== undefined)
    setClauses.push(`content = '${escape(updates.content)}'`);
  if (updates.mime_type !== undefined)
    setClauses.push(`mime_type = '${escape(updates.mime_type)}'`);

  const result = await conn.runAndReadAll(`
    UPDATE context_items
    SET ${setClauses.join(", ")}
    WHERE id = '${escape(id)}'
    RETURNING *
  `);
  const rows = result.getRows();
  return rows.length > 0 ? rowToContextItem(rows[0]!) : null;
}

export async function updateContextItemContent(
  conn: DuckDBConnection,
  contextPath: string,
  content: string,
): Promise<ContextItem | null> {
  const result = await conn.runAndReadAll(`
    UPDATE context_items
    SET content = '${escape(content)}', updated_at = current_timestamp
    WHERE context_path = '${escape(contextPath)}'
    RETURNING *
  `);
  const rows = result.getRows();
  return rows.length > 0 ? rowToContextItem(rows[0]!) : null;
}

export async function applyPatchesToContextItem(
  conn: DuckDBConnection,
  contextPath: string,
  patches: Patch[],
): Promise<{ item: ContextItem; applied: number }> {
  const item = await getContextItemByPath(conn, contextPath);
  if (!item) throw new Error(`Not found: ${contextPath}`);
  if (item.content == null) throw new Error(`No text content: ${contextPath}`);

  const lines = item.content.split("\n");

  // Sort patches by start_line descending so we apply bottom-up
  const sorted = [...patches].sort((a, b) => b.start_line - a.start_line);

  for (const patch of sorted) {
    if (patch.end_line === 0) {
      // Insert at start_line without replacing
      const insertLines =
        patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, 0, ...insertLines);
    } else {
      // Replace lines [start_line, end_line] inclusive (1-based)
      const deleteCount = patch.end_line - patch.start_line + 1;
      const insertLines =
        patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, deleteCount, ...insertLines);
    }
  }

  const newContent = lines.join("\n");
  const updated = await updateContextItemContent(conn, contextPath, newContent);
  if (!updated) throw new Error(`Failed to update: ${contextPath}`);
  return { item: updated, applied: patches.length };
}

export async function copyContextItem(
  conn: DuckDBConnection,
  srcPath: string,
  dstPath: string,
): Promise<ContextItem> {
  const src = await getContextItemByPath(conn, srcPath);
  if (!src) throw new Error(`Not found: ${srcPath}`);

  return createContextItem(conn, {
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
  conn: DuckDBConnection,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const result = await conn.runAndReadAll(`
    UPDATE context_items
    SET context_path = '${escape(newPath)}', updated_at = current_timestamp
    WHERE context_path = '${escape(oldPath)}'
    RETURNING id
  `);
  if (result.getRows().length === 0) {
    throw new Error(`Not found: ${oldPath}`);
  }
}

// --- Deletion ---

export async function deleteContextItem(
  conn: DuckDBConnection,
  id: string,
): Promise<boolean> {
  // Delete embeddings first (foreign key)
  await conn.run(
    `DELETE FROM embeddings WHERE context_item_id = '${escape(id)}'`,
  );
  const result = await conn.runAndReadAll(
    `DELETE FROM context_items WHERE id = '${escape(id)}' RETURNING id`,
  );
  return result.getRows().length > 0;
}

export async function deleteContextItemByPath(
  conn: DuckDBConnection,
  contextPath: string,
): Promise<boolean> {
  // Get ID first so we can cascade embeddings
  const item = await getContextItemByPath(conn, contextPath);
  if (!item) return false;
  return deleteContextItem(conn, item.id);
}

export async function deleteContextItemsByPrefix(
  conn: DuckDBConnection,
  prefix: string,
): Promise<number> {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  // Delete embeddings for all matching items
  await conn.run(`
    DELETE FROM embeddings
    WHERE context_item_id IN (
      SELECT id FROM context_items
      WHERE context_path LIKE '${escape(normalizedPrefix)}%'
    )
  `);

  const result = await conn.runAndReadAll(`
    DELETE FROM context_items
    WHERE context_path LIKE '${escape(normalizedPrefix)}%'
    RETURNING id
  `);
  return result.getRows().length;
}

// --- Search ---

export async function searchContextByKeyword(
  conn: DuckDBConnection,
  query: string,
  limit = 20,
): Promise<ContextItem[]> {
  const escaped = escape(query);
  const result = await conn.runAndReadAll(`
    SELECT * FROM context_items
    WHERE content IS NOT NULL
      AND (
        lower(content) LIKE lower('%${escaped}%')
        OR lower(title) LIKE lower('%${escaped}%')
      )
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);
  return result.getRows().map(rowToContextItem);
}
