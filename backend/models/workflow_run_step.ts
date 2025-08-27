import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { responseTypes } from "./agent";
import { workflows } from "./workflow";
import { workflow_runs } from "./workflow_run";
import { workflow_steps } from "./workflow_step";

export const workflowRunStepStatus = pgEnum("workflow_run_step_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const workflow_run_steps = pgTable("workflow_run_steps", {
  id: serial("id").primaryKey(),
  workflowRunId: integer("workflow_run_id")
    .references(() => workflow_runs.id, {
      onDelete: "cascade",
    })
    .notNull(),
  workflowStepId: integer("workflow_step_id")
    .references(() => workflow_steps.id, {
      onDelete: "cascade",
    })
    .notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  systemPrompt: text("system_prompt").notNull(),
  userPrompt: text("user_message").notNull(),
  input: text("input"),
  output: text("output").$type<string | null>(),
  responseType: responseTypes("type").notNull(),
  status: workflowRunStepStatus("workflow_run_step_status")
    .default("pending")
    .notNull(),
  workflowId: integer("workflow_id").references(() => workflows.id, {
    onDelete: "cascade",
  }),
});

export type WorkflowRunStep = typeof workflow_run_steps.$inferSelect;
export type NewWorkflowRunStep = typeof workflow_run_steps.$inferInsert;
