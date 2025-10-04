import {
  integer,
  json,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { agents } from "./agent";
import { workflow_runs } from "./workflow_run";

export const memoryTypes = pgEnum("memory_type", [
  "fact",
  "conversation",
  "result",
  "context",
]);

export const agent_memories = pgTable("agent_memories", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  agentId: integer("agent_id")
    .references(() => agents.id, { onDelete: "cascade" })
    .notNull(),

  // Memory content
  key: varchar("key", { length: 256 }).notNull(),
  content: text("content").notNull(),
  memoryType: memoryTypes("memory_type").notNull().default("fact"),

  // Context linking (optional)
  workflowRunId: integer("workflow_run_id").references(() => workflow_runs.id, {
    onDelete: "set null",
  }),

  // Metadata
  metadata: json("metadata").$type<Record<string, any>>().default({}).notNull(),
  expiresAt: timestamp("expires_at"),
});

export type AgentMemory = typeof agent_memories.$inferSelect;
export type NewAgentMemory = typeof agent_memories.$inferInsert;
