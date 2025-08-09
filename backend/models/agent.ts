import {
  pgTable,
  serial,
  varchar,
  timestamp,
  text,
  boolean,
  integer,
  json,
} from "drizzle-orm/pg-core";

import { users } from "./user";

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  model: varchar("model", { length: 256 }).notNull(),
  systemPrompt: text("system_prompt").notNull(),
  contextSummary: text("context_summary"),
  enabled: boolean("enabled").notNull().default(false),
  schedule: text("schedule"),
  scheduleNextRun: timestamp("schedule_next_run"),
  scheduleLastRun: timestamp("schedule_last_run"),
  scheduleLastRunResult: text("schedule_last_run_result"),
  scheduleLastRunError: text("schedule_last_run_error"),
  toolkits: json("toolkits").$type<string[]>().default([]).notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
