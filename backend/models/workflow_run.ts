import {
  pgTable,
  serial,
  timestamp,
  text,
  integer,
  json,
  pgEnum,
} from "drizzle-orm/pg-core";

import { workflows } from "./workflow";

export const workflowRunStatus = pgEnum("workflow_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const workflow_runs = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
  workflowId: integer("workflow_id")
    .references(() => workflows.id, { onDelete: "cascade" })
    .notNull(),
  status: workflowRunStatus("workflow_run_status").default("pending").notNull(),
  input: json("input").$type<Record<string, any>>().default({}).notNull(),
  output: json("output").$type<Record<string, any> | null>(),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  metadata: json("metadata").$type<Record<string, any>>().default({}).notNull(),
});

export type WorkflowRun = typeof workflow_runs.$inferSelect;
export type NewWorkflowRun = typeof workflow_runs.$inferInsert;
