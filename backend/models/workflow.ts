import {
  pgTable,
  serial,
  varchar,
  timestamp,
  text,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

import { users } from "./user";

export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
});

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
