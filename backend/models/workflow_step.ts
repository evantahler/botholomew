import {
  pgTable,
  serial,
  timestamp,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

import { workflows } from "./workflow";
import { agents } from "./agent";

export const stepTypes = pgEnum("step_type", [
  "agent",
  "condition",
  "loop",
  "webhook",
  "delay",
  "manual",
  "timer",
]);

export const workflow_steps = pgTable("workflow_steps", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  workflowId: integer("workflow_id")
    .references(() => workflows.id, { onDelete: "cascade" })
    .notNull(),
  agentId: integer("agent_id").references(() => agents.id, {
    onDelete: "cascade",
  }),
  stepType: stepTypes("step_type").notNull(),
  position: integer("position").notNull().default(1),
});

export type WorkflowStep = typeof workflow_steps.$inferSelect;
export type NewWorkflowStep = typeof workflow_steps.$inferInsert;
