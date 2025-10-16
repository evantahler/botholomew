import {
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { agents } from "./agent";
import { workflows } from "./workflow";

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
  position: integer("position").notNull().default(1),
  // Conditional branching fields
  stepType: varchar("step_type", { length: 50 })
    .notNull()
    .default("agent")
    .$type<"agent" | "condition" | "early-exit">(),
  conditionType: varchar("condition_type", { length: 50 }).$type<
    "output_contains" | "output_equals" | "output_matches"
  >(),
  conditionValue: varchar("condition_value", { length: 1000 }),
  branches: jsonb("branches").$type<{
    true?: number; // Next step position if condition is true
    false?: number; // Next step position if condition is false
  }>(),
});

export type WorkflowStep = typeof workflow_steps.$inferSelect;
export type NewWorkflowStep = typeof workflow_steps.$inferInsert;
