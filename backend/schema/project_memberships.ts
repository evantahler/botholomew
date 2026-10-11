import {
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

/**
 * A `project_membership` links a user to a project they belong to. The
 * `unique(userId, projectId)` constraint guarantees at most one membership per
 * user per project. Membership alone grants read access to the project; the
 * reserved `admin` tag grants administrative rights.
 */
export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => ({
    userProjectIndex: uniqueIndex("membership_user_project_idx").on(
      t.userId,
      t.projectId,
    ),
  }),
);

export type ProjectMembership = typeof projectMemberships.$inferSelect;
export type NewProjectMembership = typeof projectMemberships.$inferInsert;
