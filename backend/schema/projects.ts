import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * A `project` is Botholomew's tenant and its privacy boundary. Every user gets
 * their own project on signup, and teammates join via memberships. Memberships,
 * tags, and invites belong to a project, and so does everything a project's bots
 * do and remember.
 *
 * `slug` is generated from the name for display and URLs; it is deliberately
 * **not** unique, because two teams may legitimately name a project the same
 * thing and the id is what addresses a project.
 *
 * **Every timestamp column in this app is `{ withTimezone: true }`**, here and in
 * every other table. It is not decoration: Drizzle writes and reads a naked
 * `timestamp` as UTC, while `defaultNow()` resolves to Postgres's `now()` in the
 * *server's* zone — so on a machine that is not UTC, a row's `createdAt` reads
 * back hours away from when it was written, and comparing it to an
 * app-generated `expiresAt` silently misjudges expiry by that offset. A
 * `timestamptz` stores an instant, and both sides agree on which one.
 */
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  slug: text("slug").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
