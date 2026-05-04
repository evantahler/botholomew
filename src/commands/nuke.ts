import { rm } from "node:fs/promises";
import ansis from "ansis";
import type { Command } from "commander";
import {
  CONTEXT_DIR,
  getContextDir,
  SCHEDULES_DIR,
  TASKS_DIR,
} from "../constants.ts";
import type { DbConnection } from "../db/connection.ts";
import { deleteAllThreads } from "../db/threads.ts";
import { listWorkers } from "../db/workers.ts";
import { deleteAllSchedules } from "../schedules/store.ts";
import { deleteAllTasks } from "../tasks/store.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

type NukeScope = "context" | "tasks" | "schedules" | "threads" | "all";

async function ensureNoRunningWorkers(conn: DbConnection): Promise<boolean> {
  const running = await listWorkers(conn, { status: "running" });
  if (running.length > 0) {
    logger.error(
      `${running.length} worker(s) running. Stop them first: botholomew worker stop <id>`,
    );
    for (const w of running) {
      logger.dim(`  ${w.id} (pid ${w.pid}, mode=${w.mode})`);
    }
    return false;
  }
  return true;
}

async function runNuke(
  conn: DbConnection,
  projectDir: string,
  scope: NukeScope,
): Promise<void> {
  if (scope === "context" || scope === "all") {
    await rm(getContextDir(projectDir), { recursive: true, force: true });
    logger.success(`Removed ${CONTEXT_DIR}/ directory`);
  }
  if (scope === "tasks" || scope === "all") {
    const n = await deleteAllTasks(projectDir);
    logger.success(`Deleted ${n} task file(s) from ${TASKS_DIR}/`);
  }
  if (scope === "schedules" || scope === "all") {
    const n = await deleteAllSchedules(projectDir);
    logger.success(`Deleted ${n} schedule file(s) from ${SCHEDULES_DIR}/`);
  }
  if (scope === "threads" || scope === "all") {
    const { threads, interactions } = await deleteAllThreads(conn);
    logger.success(`Deleted ${threads} threads, ${interactions} interactions`);
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
        if (!(await ensureNoRunningWorkers(conn))) {
          process.exit(1);
        }

        if (!opts.yes) {
          console.log(ansis.red.bold(`Nuke scope: ${scope}`));
          console.log(
            ansis.yellow(
              `Re-run with --yes to confirm. This will delete files on disk; cannot be undone.`,
            ),
          );
          process.exit(1);
        }

        await runNuke(conn, dir, scope);
      }),
    );
}

export function registerNukeCommand(program: Command) {
  const nuke = program
    .command("nuke")
    .description("Bulk-erase sections of the project");

  registerScope(
    program,
    nuke,
    "context",
    `Erase the entire ${CONTEXT_DIR}/ directory`,
  );
  registerScope(
    program,
    nuke,
    "tasks",
    `Delete all task files in ${TASKS_DIR}/`,
  );
  registerScope(
    program,
    nuke,
    "schedules",
    `Delete all schedule files in ${SCHEDULES_DIR}/`,
  );
  registerScope(
    program,
    nuke,
    "threads",
    "Erase all threads and interactions (worker + chat history)",
  );
  registerScope(
    program,
    nuke,
    "all",
    "Erase all agent-writable data: context/, tasks/, schedules/, threads, daemon state",
  );
}
