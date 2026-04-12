import type { Command } from "commander";
import ansis from "ansis";
import { getDbPath } from "../constants.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import { createTask, listTasks, getTask } from "../db/tasks.ts";
import type { Task } from "../db/tasks.ts";
import { logger } from "../utils/logger.ts";

export function registerTaskCommand(program: Command) {
  const task = program
    .command("task")
    .description("Manage tasks");

  task
    .command("list")
    .description("List all tasks")
    .option("-s, --status <status>", "filter by status")
    .option("-p, --priority <priority>", "filter by priority")
    .option("-l, --limit <n>", "max number of tasks", parseInt)
    .action(async (opts) => {
      const dir = program.opts().dir;
      const conn = await getConnection(getDbPath(dir));
      await migrate(conn);

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

      conn.closeSync();
    });

  task
    .command("add <name>")
    .description("Create a new task")
    .option("--description <text>", "task description", "")
    .option("-p, --priority <priority>", "low, medium, or high", "medium")
    .action(async (name, opts) => {
      const dir = program.opts().dir;
      const conn = await getConnection(getDbPath(dir));
      await migrate(conn);

      const t = await createTask(conn, {
        name,
        description: opts.description,
        priority: opts.priority,
      });

      logger.success(`Created task: ${t.name} (${t.id})`);
      conn.closeSync();
    });

  task
    .command("view <id>")
    .description("View task details")
    .action(async (id) => {
      const dir = program.opts().dir;
      const conn = await getConnection(getDbPath(dir));
      await migrate(conn);

      const t = await getTask(conn, id);
      if (!t) {
        logger.error(`Task not found: ${id}`);
        process.exit(1);
      }

      printTaskDetail(t);
      conn.closeSync();
    });
}

function statusColor(status: Task["status"]): string {
  switch (status) {
    case "pending": return ansis.yellow(status);
    case "in_progress": return ansis.blue(status);
    case "complete": return ansis.green(status);
    case "failed": return ansis.red(status);
    case "waiting": return ansis.magenta(status);
  }
}

function priorityColor(priority: Task["priority"]): string {
  switch (priority) {
    case "high": return ansis.red(priority);
    case "medium": return ansis.yellow(priority);
    case "low": return ansis.dim(priority);
  }
}

function printTask(t: Task) {
  const id = ansis.dim(t.id.slice(0, 8));
  console.log(`  ${id}  ${statusColor(t.status)}  ${priorityColor(t.priority)}  ${t.name}`);
}

function printTaskDetail(t: Task) {
  console.log(ansis.bold(t.name));
  console.log(`  ID:          ${t.id}`);
  console.log(`  Status:      ${statusColor(t.status)}`);
  console.log(`  Priority:    ${priorityColor(t.priority)}`);
  if (t.description) console.log(`  Description: ${t.description}`);
  if (t.waiting_reason) console.log(`  Waiting:     ${t.waiting_reason}`);
  if (t.claimed_by) console.log(`  Claimed by:  ${t.claimed_by}`);
  if (t.blocked_by.length > 0) console.log(`  Blocked by:  ${t.blocked_by.join(", ")}`);
  console.log(`  Created:     ${t.created_at.toISOString()}`);
  console.log(`  Updated:     ${t.updated_at.toISOString()}`);
}
