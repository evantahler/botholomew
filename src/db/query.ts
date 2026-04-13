type SqlParam = string | number | null;

/**
 * Build a WHERE clause from column-value pairs.
 * Entries with `undefined` values are skipped.
 */
export function buildWhereClause(filters: [string, SqlParam | undefined][]): {
  where: string;
  params: SqlParam[];
} {
  const conditions: string[] = [];
  const params: SqlParam[] = [];

  for (const [col, val] of filters) {
    if (val !== undefined) {
      params.push(val);
      conditions.push(`${col} = ?${params.length}`);
    }
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

/**
 * Build SET clauses for an UPDATE from column-value pairs.
 * Entries with `undefined` values are skipped.
 */
export function buildSetClauses(fields: [string, SqlParam | undefined][]): {
  setClauses: string[];
  params: SqlParam[];
} {
  const setClauses: string[] = [];
  const params: SqlParam[] = [];

  for (const [col, val] of fields) {
    if (val !== undefined) {
      params.push(val);
      setClauses.push(`${col} = ?${params.length}`);
    }
  }

  return { setClauses, params };
}
