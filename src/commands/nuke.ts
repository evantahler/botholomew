import { rm } from "node:fs/promises";
import ansis from "ansis";
import type { Command } from "commander";
import {
  CONTEXT_DIR,
  getContextDir,
  SCHEDULES_DIR,
  TASKS_DIR,
  THREADS_SUBDIR,
} from "../constants.ts";
import { deleteAllSchedules } from "../schedules/store.ts";
import { deleteAllTasks } from "../tasks/store.ts";
import { deleteAllThreads } from "../threads/store.ts";
import { logger } from "../utils/logger.ts";
import { listWorkers } from "../workers/store.ts";

type NukeScope = "context" | "tasks" | "schedules" | "threads" | "all";

async function ensureNoRunningWorkers(projectDir: string): Promise<boolean> {
  const running = await listWorkers(projectDir, { status: "running" });
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

async function runNuke(projectDir: string, scope: NukeScope): Promise<void> {
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
    const { threads, interactions } = await deleteAllThreads(projectDir);
    logger.success(
      `Deleted ${threads} threads (${interactions} interactions) from ${CONTEXT_DIR}/${THREADS_SUBDIR}/`,
    );
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
    .action(async (opts) => {
      const dir = program.opts().dir;
      if (!(await ensureNoRunningWorkers(dir))) {
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

      await runNuke(dir, scope);
    });
}

export function registerNukeCommand(program: Command) {
  const nuke = program
    .command("nuke")
    .description("Bulk-erase sections of the project");

  registerScope(
    program,
    nuke,
    "context",
    `Erase the entire ${CONTEXT_DIR}/ directory (includes ${THREADS_SUBDIR}/)`,
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
    `Delete all conversation history in ${CONTEXT_DIR}/${THREADS_SUBDIR}/`,
  );
  registerScope(
    program,
    nuke,
    "all",
    "Erase all agent-writable data: context/ (incl. threads), tasks/, schedules/",
  );
}
