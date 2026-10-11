import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * A `user` is a person who signs in to Botholomew. Email is the only identity
 * constraint: it is unique (case-insensitively, because every action lowercases
 * it before it reaches the database). `name` is deliberately **not** unique — it
 * is a display name, and making it unique would force every test and every
 * signup form to invent one.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 256 }).notNull(),
    email: text("email").notNull().unique(),
    password_hash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => ({
    emailIndex: uniqueIndex("user_email_idx").on(t.email),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
