import ansis from "ansis";
import type { Command } from "commander";
import type { DbConnection } from "../db/connection.ts";
import { deleteAllContextItems } from "../db/context.ts";
import { deleteAllDaemonState } from "../db/daemon-state.ts";
import { deleteAllSchedules } from "../db/schedules.ts";
import { deleteAllTasks } from "../db/tasks.ts";
import { deleteAllThreads } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";
import { getDaemonStatus } from "../utils/pid.ts";
import { withDb } from "./with-db.ts";

type NukeScope = "context" | "tasks" | "schedules" | "threads" | "all";

const TABLES_BY_SCOPE: Record<NukeScope, string[]> = {
  context: ["context_items", "embeddings"],
  tasks: ["tasks"],
  schedules: ["schedules"],
  threads: ["threads", "interactions"],
  all: [
    "context_items",
    "embeddings",
    "tasks",
    "schedules",
    "threads",
    "interactions",
    "daemon_state",
  ],
};

async function countRows(conn: DbConnection, table: string): Promise<number> {
  const row = await conn.queryGet<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ${table}`,
  );
  return row ? Number(row.cnt) : 0;
}

function printDryRun(scope: NukeScope, counts: Record<string, number>) {
  console.log(ansis.red.bold(`Nuke scope: ${scope}`));
  console.log("Would delete:");
  const nameWidth = Math.max(...Object.keys(counts).map((k) => k.length));
  for (const [table, count] of Object.entries(counts)) {
    const padded = table.padEnd(nameWidth + 2);
    console.log(`  ${padded}${ansis.dim(`${count} rows`)}`);
  }
  console.log("");
  console.log(
    ansis.yellow("Re-run with --yes to confirm. This cannot be undone."),
  );
}

async function ensureDaemonStopped(dir: string): Promise<boolean> {
  const status = await getDaemonStatus(dir);
  if (status) {
    logger.error(
      `Daemon is running (PID ${status.pid}). Stop it first: botholomew daemon stop`,
    );
    return false;
  }
  return true;
}

async function runNuke(conn: DbConnection, scope: NukeScope): Promise<void> {
  // Not wrapped in a transaction: DuckDB's FK index checks on DELETE FROM
  // threads inside a transaction see stale interactions rows even after
  // DELETE FROM interactions ran in the same transaction. Each helper is
  // already a small sequence of statements, so auto-commit is fine for a
  // destructive dev-time tool.
  if (scope === "context" || scope === "all") {
    const { contextItems, embeddings } = await deleteAllContextItems(conn);
    logger.success(
      `Deleted ${contextItems} context_items, ${embeddings} embeddings`,
    );
  }
  if (scope === "tasks" || scope === "all") {
    const n = await deleteAllTasks(conn);
    logger.success(`Deleted ${n} tasks`);
  }
  if (scope === "schedules" || scope === "all") {
    const n = await deleteAllSchedules(conn);
    logger.success(`Deleted ${n} schedules`);
  }
  if (scope === "threads" || scope === "all") {
    const { threads, interactions } = await deleteAllThreads(conn);
    logger.success(`Deleted ${threads} threads, ${interactions} interactions`);
  }
  if (scope === "all") {
    const n = await deleteAllDaemonState(conn);
    logger.success(`Deleted ${n} daemon_state entries`);
  }
}

function registerScope(
  program: Command,
  parent: Command,
  scope: NukeScope,
  description: string,
) {
  parent
    .command(scope)
    .description(description)
    .option("-y, --yes", "confirm the deletion (required)")
    .action((opts) =>
      withDb(program, async (conn, dir) => {
        if (!(await ensureDaemonStopped(dir))) {
          process.exit(1);
        }
        const tables = TABLES_BY_SCOPE[scope];
        const counts: Record<string, number> = {};
        for (const t of tables) {
          counts[t] = await countRows(conn, t);
        }

        if (!opts.yes) {
          printDryRun(scope, counts);
          process.exit(1);
        }

        await runNuke(conn, scope);
      }),
    );
}

export function registerNukeCommand(program: Command) {
  const nuke = program
    .command("nuke")
    .description("Bulk-erase sections of the database");

  registerScope(
    program,
    nuke,
    "context",
    "Erase all context_items and embeddings",
  );
  registerScope(program, nuke, "tasks", "Erase all tasks");
  registerScope(program, nuke, "schedules", "Erase all schedules");
  registerScope(
    program,
    nuke,
    "threads",
    "Erase all threads and interactions (daemon + chat history)",
  );
  registerScope(
    program,
    nuke,
    "all",
    "Erase everything in the database (preserves schema, skills, and on-disk soul/beliefs/goals)",
  );
}
