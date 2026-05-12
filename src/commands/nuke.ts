import { rm } from "node:fs/promises";
import { join } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { SCHEDULES_DIR, TASKS_DIR, THREADS_DIR } from "../constants.ts";
import { openMembot } from "../mem/client.ts";
import { deleteAllSchedules } from "../schedules/store.ts";
import { deleteAllTasks } from "../tasks/store.ts";
import { deleteAllThreads } from "../threads/store.ts";
import { logger } from "../utils/logger.ts";
import { listWorkers } from "../workers/store.ts";

type NukeScope = "knowledge" | "tasks" | "schedules" | "threads" | "all";

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

/**
 * Erase the membot knowledge store: tombstone every current file and prune
 * non-current versions. We do this through the SDK rather than `rm`ing
 * `index.duckdb` directly so a concurrent open client (e.g. a tool call in
 * mid-flight) doesn't lose data unpredictably; if the file is empty / missing
 * we fall back to deleting it outright.
 */
async function nukeKnowledge(projectDir: string): Promise<void> {
  const indexPath = join(projectDir, "index.duckdb");
  try {
    const mem = openMembot(projectDir);
    try {
      const list = await mem.list({ limit: 100_000 });
      const paths = list.entries.map((e) => e.logical_path);
      if (paths.length > 0) {
        await mem.remove({ paths });
      }
      // Drop all versions older than now (i.e. everything we just tombstoned).
      await mem.prune({ before: new Date().toISOString() });
      logger.success(
        `Cleared the membot knowledge store (${paths.length} entries removed, history pruned)`,
      );
    } finally {
      await mem.close();
    }
  } catch (err) {
    logger.warn(
      `membot prune failed (${(err as Error).message}); removing ${indexPath} instead`,
    );
    await rm(indexPath, { force: true });
    logger.success(`Removed ${indexPath}`);
  }
}

async function runNuke(projectDir: string, scope: NukeScope): Promise<void> {
  if (scope === "knowledge" || scope === "all") {
    await nukeKnowledge(projectDir);
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
      `Deleted ${threads} threads (${interactions} interactions) from ${THREADS_DIR}/`,
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
            `Re-run with --yes to confirm. This will delete data; cannot be undone.`,
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
    "knowledge",
    "Erase the entire membot knowledge store (every current entry tombstoned and pruned)",
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
    `Delete all conversation history in ${THREADS_DIR}/`,
  );
  registerScope(
    program,
    nuke,
    "all",
    "Erase all agent-writable data: membot store, tasks/, schedules/, threads/",
  );
}
