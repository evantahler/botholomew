import {
  pgTable,
  serial,
  varchar,
  timestamp,
  text,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

import { agents } from "./agent";

export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  agentId: integer("agent_id").references(() => agents.id),
  role: messageRole("role").notNull(),
  content: text("content").notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
