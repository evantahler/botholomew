import {
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * A `tag` is a named, project-scoped permission label. Botholomew has no role
 * ladder: access is granted to sets of tags. The reserved `admin` tag (created
 * for the owner by the signup bootstrap) confers administrative rights on its
 * project; it cannot be created, renamed, or deleted through the tag actions.
 * `unique(projectId, name)` keeps tag names unique within a project.
 */
export const tags = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => ({
    projectNameIndex: uniqueIndex("tag_project_name_idx").on(
      t.projectId,
      t.name,
    ),
  }),
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
