import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

/**
 * A `project_invite` records an admin's invitation of an email address to join a
 * project with a set of tags. No email is sent — invites surface in-app to the
 * invitee on their next login, keyed on the (lowercased) email, so a brand-new
 * signup sees them immediately. Email delivery is not built yet.
 *
 * `inviterEmail` and `projectName` are denormalized so the invitee's card needs
 * no joins. `tagIds` is a typed `jsonb` array rather than a join table: invites
 * are short-lived and never queried by tag. Invites expire after five days.
 */
export const projectInvites = pgTable(
  "project_invites",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inviterUserId: integer("inviter_user_id")
      .notNull()
      .references(() => users.id),
    inviteeEmail: text("invitee_email").notNull(),
    tagIds: jsonb("tag_ids").$type<number[]>().notNull().default([]),
    status: text("status").notNull().default("pending"),
    inviterEmail: text("inviter_email").notNull(),
    projectName: text("project_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    inviteeEmailIndex: index("invite_invitee_email_idx").on(t.inviteeEmail),
  }),
);

export type ProjectInvite = typeof projectInvites.$inferSelect;
export type NewProjectInvite = typeof projectInvites.$inferInsert;
