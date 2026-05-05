import ansis from "ansis";
import type { Command } from "commander";
import type { Task } from "../tasks/schema.ts";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  updateTaskStatus,
} from "../tasks/store.ts";
import { logger } from "../utils/logger.ts";

export function registerTaskCommand(program: Command) {
  const task = program.command("task").description("Manage tasks");

  task
    .command("list")
    .description("List all tasks (newest first)")
    .option("-s, --status <status>", "filter by status")
    .option("-p, --priority <priority>", "filter by priority")
    .option("-l, --limit <n>", "max number of tasks", Number.parseInt)
    .option("-o, --offset <n>", "skip first N tasks", Number.parseInt)
    .action(async (opts) => {
      const dir = program.opts().dir;
      const tasks = await listTasks(dir, {
        status: opts.status,
        priority: opts.priority,
        limit: opts.limit,
        offset: opts.offset,
      });

      if (tasks.length === 0) {
        logger.dim("No tasks found.");
        return;
      }

      const header = `${ansis.bold("ID".padEnd(36))}  ${ansis.bold("Status".padEnd(11))}  ${ansis.bold("Priority".padEnd(6))}  ${ansis.bold("Created".padEnd(19))}  ${ansis.bold("Updated".padEnd(19))}  ${ansis.bold("Name")}`;
      console.log(header);
      console.log("-".repeat(120));

      for (const t of tasks) {
        printTask(t);
      }

      console.log(`\n${ansis.dim(`${tasks.length} task(s)`)}`);
    });

  task
    .command("add <name>")
    .description("Create a new task")
    .option("--description <text>", "task description", "")
    .option("-p, --priority <priority>", "low, medium, or high", "medium")
    .action(async (name, opts) => {
      const dir = program.opts().dir;
      const t = await createTask(dir, {
        name,
        description: opts.description,
        priority: opts.priority,
      });
      logger.success(`Created task: ${t.name} (${t.id})`);
    });

  task
    .command("view <id>")
    .description("View task details")
    .action(async (id) => {
      const dir = program.opts().dir;
      const t = await getTask(dir, id);
      if (!t) {
        logger.error(`Task not found: ${id}`);
        process.exit(1);
      }
      printTaskDetail(t);
    });

  task
    .command("update <id>")
    .description("Update a task")
    .option("--name <text>", "new task name")
    .option("--description <text>", "new description")
    .option("-p, --priority <priority>", "low, medium, or high")
    .option("-s, --status <status>", "new status")
    .action(async (id, opts) => {
      const dir = program.opts().dir;
      const updates: Parameters<typeof updateTask>[2] = {};
      if (opts.name) updates.name = opts.name;
      if (opts.description) updates.description = opts.description;
      if (opts.priority) updates.priority = opts.priority;
      if (opts.status) updates.status = opts.status;

      try {
        const t = await updateTask(dir, id, updates);
        if (!t) {
          logger.error(`Task not found: ${id}`);
          process.exit(1);
        }
        printTaskDetail(t);
      } catch (err) {
        logger.error(String(err));
        process.exit(1);
      }
    });

  task
    .command("delete <id>")
    .description("Delete a task")
    .action(async (id) => {
      const dir = program.opts().dir;
      const deleted = await deleteTask(dir, id);
      if (!deleted) {
        logger.error(`Task not found: ${id}`);
        process.exit(1);
      }
      logger.success(`Deleted task: ${id}`);
    });

  task
    .command("reset <id>")
    .description("Reset a stuck task back to pending")
    .action(async (id) => {
      const dir = program.opts().dir;
      const t = await getTask(dir, id);
      if (!t) {
        logger.error(`Task not found: ${id}`);
        process.exit(1);
      }
      await updateTaskStatus(dir, id, "pending", null, null);
      logger.success(`Reset task: ${t.name} (${t.id})`);
    });
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

function formatTime(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function padColored(colored: string, raw: string, width: number): string {
  const padding = Math.max(0, width - raw.length);
  return colored + " ".repeat(padding);
}

function printTask(t: Task) {
  const id = ansis.dim(t.id.padEnd(36));
  const status = padColored(statusColor(t.status), t.status, 11);
  const priority = padColored(priorityColor(t.priority), t.priority, 6);
  const created = ansis.dim(formatTime(t.created_at).padEnd(19));
  const updated = ansis.dim(formatTime(t.updated_at).padEnd(19));
  console.log(
    `${id}  ${status}  ${priority}  ${created}  ${updated}  ${t.name}`,
  );
}

function printTaskDetail(t: Task) {
  console.log(ansis.bold(t.name));
  console.log(`  ID:          ${t.id}`);
  console.log(`  Status:      ${statusColor(t.status)}`);
  console.log(`  Priority:    ${priorityColor(t.priority)}`);
  if (t.description) console.log(`  Description: ${t.description}`);
  if (t.waiting_reason) console.log(`  Waiting:     ${t.waiting_reason}`);
  if (t.output) console.log(`  Output:      ${t.output}`);
  if (t.claimed_by) console.log(`  Claimed by:  ${t.claimed_by}`);
  if (t.blocked_by.length > 0)
    console.log(`  Blocked by:  ${t.blocked_by.join(", ")}`);
  console.log(`  Created:     ${t.created_at}`);
  console.log(`  Updated:     ${t.updated_at}`);
}
