/**
 * Reconcile every serial/identity sequence with the table column it uses.
 *
 * A database restore can load explicit ids without advancing the corresponding
 * sequences. The next ordinary insert then reuses an existing primary key. Run
 * this once against the restored database:
 *
 *   DATABASE_URL=postgres://... bun run db:repair-sequences
 *
 * Discovery does **not** rely on `pg_depend` ownership. A restore can leave
 * `nextval(...)` defaults in place while dropping the OWNED BY link, so a
 * catalog walk of owned sequences can report `checked: 0` against a database
 * whose sequences still collide.
 *
 * Each table is locked against concurrent inserts while its maximum value and
 * sequence state are compared. A sequence that is already ahead is never moved
 * backwards, so the script is safe to run more than once.
 */
import "../index";

import { sql } from "drizzle-orm";
import { api, RUN_MODE } from "keryx";

interface OwnedSequence {
  table_schema: string;
  table_name: string;
  column_name: string;
  sequence_schema: string;
  sequence_name: string;
}

interface SequenceValue {
  value: string;
  is_called?: boolean;
}

/** Quote one Postgres identifier obtained from the system catalog. */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Qualify and quote a schema-owned Postgres object. */
function qualified(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

/**
 * Drizzle's node-postgres execute result is `{ rows }`; some wrappers return
 * the row array itself. Either way we need a length we can report.
 */
function rowsOf<T>(
  result: { rows?: unknown } | unknown[] | null | undefined,
): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

// `start`, not `initialize`: the database initializer opens the pool and builds
// `api.db.db` in its start phase. CLI mode keeps this to a connection — no HTTP
// server, no resque scheduler, and no task workers claiming jobs.
await api.start(RUN_MODE.CLI);

try {
  const repaired = await api.db.db.transaction(async (tx) => {
    // `pg_get_serial_sequence` follows the column's default / identity, which
    // survives a restore that dropped OWNED BY. Restricting to `public` is
    // also wrong here: Render's search_path may put application tables in
    // another user schema.
    const discovered = await tx.execute(
      sql.raw(`
      SELECT DISTINCT ON (n.nspname, c.relname, a.attname)
        n.nspname AS table_schema,
        c.relname AS table_name,
        a.attname AS column_name,
        seq_n.nspname AS sequence_schema,
        seq.relname AS sequence_name
      FROM (
        SELECT
          n.nspname,
          c.oid AS table_oid,
          a.attnum,
          pg_get_serial_sequence(
            format('%I.%I', n.nspname, c.relname),
            a.attname
          ) AS seq_ident
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a
          ON a.attrelid = c.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
        WHERE c.relkind IN ('r', 'p')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND pg_get_serial_sequence(
            format('%I.%I', n.nspname, c.relname),
            a.attname
          ) IS NOT NULL
        UNION ALL
        SELECT
          n.nspname,
          c.oid,
          a.attnum,
          (regexp_match(
            pg_get_expr(def.adbin, def.adrelid),
            'nextval\\(''(.*)''::regclass\\)'
          ))[1]
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a
          ON a.attrelid = c.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
        JOIN pg_attrdef def
          ON def.adrelid = c.oid
          AND def.adnum = a.attnum
        WHERE c.relkind IN ('r', 'p')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND pg_get_expr(def.adbin, def.adrelid) LIKE 'nextval(%'
      ) cols
      JOIN pg_class seq
        ON seq.oid = COALESCE(
          to_regclass(cols.seq_ident),
          to_regclass(format('%I.%s', cols.nspname, cols.seq_ident))
        )
      JOIN pg_namespace seq_n ON seq_n.oid = seq.relnamespace
      JOIN pg_namespace n ON n.nspname = cols.nspname
      JOIN pg_class c ON c.oid = cols.table_oid
      JOIN pg_attribute a
        ON a.attrelid = c.oid
        AND a.attnum = cols.attnum
      ORDER BY n.nspname, c.relname, a.attname, seq_n.nspname, seq.relname
    `),
    );

    const present = await tx.execute(
      sql.raw(`
      SELECT schemaname AS sequence_schema, sequencename AS sequence_name
        FROM pg_sequences
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY schemaname, sequencename
    `),
    );

    const owned = rowsOf<OwnedSequence>(discovered);
    const sequences = rowsOf<{
      sequence_schema: string;
      sequence_name: string;
    }>(present);

    const changes: {
      sequence: string;
      column: string;
      previous: string;
      maximum: string;
      current: string;
    }[] = [];

    for (const column of owned) {
      const table = qualified(column.table_schema, column.table_name);
      const columnName = quoteIdentifier(column.column_name);
      const sequence = qualified(column.sequence_schema, column.sequence_name);

      await tx.execute(
        sql.raw(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`),
      );

      const maximumResult = await tx.execute(
        sql.raw(
          `SELECT COALESCE(MAX(${columnName}), 0)::text AS value FROM ${table}`,
        ),
      );
      const sequenceResult = await tx.execute(
        sql.raw(`SELECT last_value::text AS value, is_called FROM ${sequence}`),
      );
      const maximum = rowsOf<SequenceValue>(maximumResult)[0]?.value;
      const state = rowsOf<SequenceValue>(sequenceResult)[0];
      if (maximum === undefined || !state) {
        throw new Error(`could not read ${table}.${columnName} / ${sequence}`);
      }
      const target =
        BigInt(maximum) > BigInt(state.value) ? maximum : state.value;
      const shouldBeCalled = BigInt(maximum) > 0n || state.is_called === true;

      if (target !== state.value || shouldBeCalled !== state.is_called) {
        await tx.execute(
          sql.raw(
            `SELECT setval('${sequence.replaceAll("'", "''")}'::regclass, ${target}::bigint, ${shouldBeCalled})`,
          ),
        );
        changes.push({
          sequence,
          column: `${table}.${columnName}`,
          previous: state.value,
          maximum,
          current: target,
        });
      }
    }

    return {
      checked: owned.length,
      sequences: sequences.length,
      repaired: changes.length,
      changes,
      discovered: owned.map(
        (column) =>
          `${qualified(column.sequence_schema, column.sequence_name)} → ${qualified(column.table_schema, column.table_name)}.${quoteIdentifier(column.column_name)}`,
      ),
    };
  });

  console.log(JSON.stringify(repaired, null, 2));
} finally {
  await api.stop();
}
