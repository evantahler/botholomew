import {
  pgTable,
  serial,
  uniqueIndex,
  varchar,
  timestamp,
  text,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    name: varchar("name", { length: 256 }).notNull(),
    email: text("email").notNull().unique(),
    password_hash: text("password_hash").notNull(),
  },
  (users) => {
    return {
      nameIndex: uniqueIndex("name_idx").on(users.name),
      emailIndex: uniqueIndex("email_idx").on(users.email),
    };
  },
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
