import ansis from "ansis";
import type { Command } from "commander";
import type { Task } from "../db/tasks.ts";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  resetTask,
  updateTask,
} from "../db/tasks.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

export function registerTaskCommand(program: Command) {
  const task = program.command("task").description("Manage tasks");

  task
    .command("list")
    .description("List all tasks")
    .option("-s, --status <status>", "filter by status")
    .option("-p, --priority <priority>", "filter by priority")
    .option("-l, --limit <n>", "max number of tasks", parseInt)
    .action((opts) =>
      withDb(program, async (conn) => {
        const tasks = await listTasks(conn, {
          status: opts.status,
          priority: opts.priority,
          limit: opts.limit,
        });

        if (tasks.length === 0) {
          logger.dim("No tasks found.");
          return;
        }

        for (const t of tasks) {
          printTask(t);
        }
      }),
    );

  task
    .command("add <name>")
    .description("Create a new task")
    .option("--description <text>", "task description", "")
    .option("-p, --priority <priority>", "low, medium, or high", "medium")
    .action((name, opts) =>
      withDb(program, async (conn) => {
        const t = await createTask(conn, {
          name,
          description: opts.description,
          priority: opts.priority,
        });
        logger.success(`Created task: ${t.name} (${t.id})`);
      }),
    );

  task
    .command("view <id>")
    .description("View task details")
    .action((id) =>
      withDb(program, async (conn) => {
        const t = await getTask(conn, id);
        if (!t) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }
        printTaskDetail(t);
      }),
    );

  task
    .command("update <id>")
    .description("Update a task")
    .option("--name <text>", "new task name")
    .option("--description <text>", "new description")
    .option("-p, --priority <priority>", "low, medium, or high")
    .option("-s, --status <status>", "new status")
    .action((id, opts) =>
      withDb(program, async (conn) => {
        const updates: Parameters<typeof updateTask>[2] = {};
        if (opts.name) updates.name = opts.name;
        if (opts.description) updates.description = opts.description;
        if (opts.priority) updates.priority = opts.priority;
        if (opts.status) updates.status = opts.status;

        try {
          const t = await updateTask(conn, id, updates);
          if (!t) {
            logger.error(`Task not found: ${id}`);
            process.exit(1);
          }
          printTaskDetail(t);
        } catch (err) {
          logger.error(String(err));
          process.exit(1);
        }
      }),
    );

  task
    .command("delete <id>")
    .description("Delete a task")
    .action((id) =>
      withDb(program, async (conn) => {
        const deleted = await deleteTask(conn, id);
        if (!deleted) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }
        logger.success(`Deleted task: ${id}`);
      }),
    );

  task
    .command("reset <id>")
    .description("Reset a stuck task back to pending")
    .action((id) =>
      withDb(program, async (conn) => {
        const t = await resetTask(conn, id);
        if (!t) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }
        logger.success(`Reset task: ${t.name} (${t.id})`);
      }),
    );
}

function statusColor(status: Task["status"]): string {
  switch (status) {
    case "pending":
      return ansis.yellow(status);
    case "in_progress":
      return ansis.blue(status);
    case "complete":
      return ansis.green(status);
    case "failed":
      return ansis.red(status);
    case "waiting":
      return ansis.magenta(status);
  }
}

function priorityColor(priority: Task["priority"]): string {
  switch (priority) {
    case "high":
      return ansis.red(priority);
    case "medium":
      return ansis.yellow(priority);
    case "low":
      return ansis.dim(priority);
  }
}

function printTask(t: Task) {
  const id = ansis.dim(t.id.slice(0, 8));
  console.log(
    `  ${id}  ${statusColor(t.status)}  ${priorityColor(t.priority)}  ${t.name}`,
  );
}

function printTaskDetail(t: Task) {
  console.log(ansis.bold(t.name));
  console.log(`  ID:          ${t.id}`);
  console.log(`  Status:      ${statusColor(t.status)}`);
  console.log(`  Priority:    ${priorityColor(t.priority)}`);
  if (t.description) console.log(`  Description: ${t.description}`);
  if (t.waiting_reason) console.log(`  Waiting:     ${t.waiting_reason}`);
  if (t.claimed_by) console.log(`  Claimed by:  ${t.claimed_by}`);
  if (t.blocked_by.length > 0)
    console.log(`  Blocked by:  ${t.blocked_by.join(", ")}`);
  console.log(`  Created:     ${t.created_at.toISOString()}`);
  console.log(`  Updated:     ${t.updated_at.toISOString()}`);
}
