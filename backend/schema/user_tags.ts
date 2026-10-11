import {
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tags } from "./tags";
import { users } from "./users";

/**
 * A `user_tag` grants a project tag to a member. Because tags are
 * project-scoped, a user's tags implicitly scope to the tag's project — there is
 * no `projectId` here on purpose. `unique(userId, tagId)` prevents assigning the
 * same tag twice.
 */
export const userTags = pgTable(
  "user_tags",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => ({
    userTagIndex: uniqueIndex("user_tag_user_tag_idx").on(t.userId, t.tagId),
  }),
);

export type UserTag = typeof userTags.$inferSelect;
export type NewUserTag = typeof userTags.$inferInsert;
