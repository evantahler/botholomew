import {
  pgTable,
  serial,
  timestamp,
  text,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

import { agents, responseTypes } from "./agent";

const runStatus = pgEnum("run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const agent_run = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  agentId: integer("agent_id")
    .references(() => agents.id, {
      onDelete: "cascade",
    })
    .notNull(),
  systemPrompt: text("system_prompt").notNull(),
  userMessage: text("user_message").notNull(),
  response: text("response").$type<string | null>(),
  type: responseTypes("type").notNull(),
  status: runStatus("status").default("pending"),
});

export type AgentRun = typeof agent_run.$inferSelect;
export type NewAgentRun = typeof agent_run.$inferInsert;
