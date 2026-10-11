import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { api } from "keryx";
import { HOOK_TIMEOUT } from "../setup";

/**
 * Indexes the schema declares for its read paths and its uniqueness rules.
 *
 * Asserted against `pg_indexes` after a real boot, so a migration that forgot
 * to create one — or created it on the wrong columns — fails here rather than
 * as a sequential scan or a duplicate row in production. The names and
 * definitions are the contract; the planner's choice of which one to use is not.
 *
 * The four unique indexes are rules, not performance: one membership per user
 * per project, one tag name per project, one grant of a tag per user, and one
 * account per email. The two `audit_logs` indexes are the two shapes that table
 * is read in — by project for `audit:list`, by time alone for `audit:sweep`.
 */
const EXPECTED_INDEXES: Record<string, { table: string; def: RegExp }> = {
  audit_logs_created_at_idx: {
    table: "audit_logs",
    def: /\(created_at\)/i,
  },
  audit_logs_project_created_at_idx: {
    table: "audit_logs",
    def: /\(project_id,\s*created_at\)/i,
  },
  invite_invitee_email_idx: {
    table: "project_invites",
    def: /\(invitee_email\)/i,
  },
  membership_user_project_idx: {
    table: "project_memberships",
    def: /UNIQUE.*\(user_id,\s*project_id\)/i,
  },
  tag_project_name_idx: {
    table: "tags",
    def: /UNIQUE.*\(project_id,\s*name\)/i,
  },
  user_tag_user_tag_idx: {
    table: "user_tags",
    def: /UNIQUE.*\(user_id,\s*tag_id\)/i,
  },
  user_email_idx: {
    table: "users",
    def: /UNIQUE.*\(email\)/i,
  },
};

beforeAll(async () => {
  await api.start();
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

describe("schema indexes", () => {
  test("the booted database has every index the schema relies on", async () => {
    const result = await api.db.db.execute(sql`
      SELECT indexname, tablename, indexdef
        FROM pg_indexes
       WHERE schemaname = 'public'
    `);

    const byName = new Map(
      (
        result.rows as {
          indexname: string;
          tablename: string;
          indexdef: string;
        }[]
      ).map((row) => [row.indexname, row]),
    );

    for (const [name, expected] of Object.entries(EXPECTED_INDEXES)) {
      const row = byName.get(name);
      if (!row) {
        throw new Error(`missing index ${name} on ${expected.table}`);
      }
      expect(row.tablename).toBe(expected.table);
      expect(row.indexdef).toMatch(expected.def);
    }
  });

  test("audit_logs carries the bot attribution columns, with no foreign key", async () => {
    // The two columns a bot's change is audited through are in the baseline,
    // nullable, and unconstrained — a deleted bot must not take its record with
    // it, for the same reason a deleted project does not.
    const columns = await api.db.db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'audit_logs'
         AND column_name IN ('actor_bot_id', 'on_behalf_of_user_id')
       ORDER BY column_name
    `);
    expect(columns.rows).toEqual([
      {
        column_name: "actor_bot_id",
        data_type: "integer",
        is_nullable: "YES",
      },
      {
        column_name: "on_behalf_of_user_id",
        data_type: "integer",
        is_nullable: "YES",
      },
    ]);

    const foreignKeys = await api.db.db.execute(sql`
      SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'audit_logs'
         AND tc.constraint_type = 'FOREIGN KEY'
    `);
    // `user_id` is the one reference, and it does not cascade.
    expect(
      (foreignKeys.rows as { column_name: string }[]).map((r) => r.column_name),
    ).toEqual(["user_id"]);
  });
});
