import {
  boolean,
  integer,
  json,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./user";

export const responseTypes = pgEnum("response_type", [
  "text",
  "json",
  "markdown",
]);

export const agents = pgTable("agents", {
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
  model: varchar("model", { length: 256 }).notNull(),
  systemPrompt: text("system_prompt").notNull(),
  userPrompt: text("user_prompt").notNull(),
  responseType: responseTypes("response_type").notNull().default("text"),
  enabled: boolean("enabled").notNull().default(false),
  toolkits: json("toolkits").$type<string[]>().default([]).notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
