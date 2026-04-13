import ansis from "ansis";
import type { Command } from "commander";
import { getDbPath } from "../constants.ts";
import { getConnection } from "../db/connection.ts";
import type { Schedule } from "../db/schedules.ts";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
} from "../db/schedules.ts";
import { migrate } from "../db/schema.ts";
import { logger } from "../utils/logger.ts";

export function registerScheduleCommand(program: Command) {
  const schedule = program.command("schedule").description("Manage schedules");

  schedule
    .command("list")
    .description("List all schedules")
    .option("--enabled", "show only enabled schedules")
    .option("--disabled", "show only disabled schedules")
    .action(async (opts) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const filters: { enabled?: boolean } = {};
      if (opts.enabled) filters.enabled = true;
      if (opts.disabled) filters.enabled = false;

      const schedules = await listSchedules(conn, filters);

      if (schedules.length === 0) {
        logger.dim("No schedules found.");
        return;
      }

      for (const s of schedules) {
        printSchedule(s);
      }

      conn.close();
    });

  schedule
    .command("add <name>")
    .description("Create a new schedule")
    .requiredOption(
      "-f, --frequency <text>",
      "how often to run (e.g. 'every morning')",
    )
    .option("--description <text>", "schedule description", "")
    .action(async (name, opts) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const s = await createSchedule(conn, {
        name,
        description: opts.description,
        frequency: opts.frequency,
      });

      logger.success(`Created schedule: ${s.name} (${s.id})`);
      conn.close();
    });

  schedule
    .command("view <id>")
    .description("View schedule details")
    .action(async (id) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const s = await getSchedule(conn, id);
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }

      printScheduleDetail(s);
      conn.close();
    });

  schedule
    .command("enable <id>")
    .description("Enable a schedule")
    .action(async (id) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const s = await updateSchedule(conn, id, { enabled: true });
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }

      logger.success(`Enabled schedule: ${s.name}`);
      conn.close();
    });

  schedule
    .command("disable <id>")
    .description("Disable a schedule")
    .action(async (id) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const s = await updateSchedule(conn, id, { enabled: false });
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }

      logger.success(`Disabled schedule: ${s.name}`);
      conn.close();
    });

  schedule
    .command("delete <id>")
    .description("Delete a schedule")
    .action(async (id) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const deleted = await deleteSchedule(conn, id);
      if (!deleted) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }

      logger.success(`Deleted schedule: ${id}`);
      conn.close();
    });

  schedule
    .command("trigger <id>")
    .description("Manually trigger a schedule (creates tasks immediately)")
    .action(async (id) => {
      const dir = program.opts().dir;
      const conn = getConnection(getDbPath(dir));
      migrate(conn);

      const s = await getSchedule(conn, id);
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }

      // Lazy import to avoid loading LLM deps for non-trigger commands
      const { evaluateSchedule } = await import("../daemon/schedules.ts");
      const { loadConfig } = await import("../config/loader.ts");
      const { createTask } = await import("../db/tasks.ts");
      const { markScheduleRun } = await import("../db/schedules.ts");

      const config = await loadConfig(dir);
      const evaluation = await evaluateSchedule(config, s);

      if (evaluation.tasksToCreate.length === 0) {
        logger.dim("Schedule evaluated but produced no tasks.");
      } else {
        const createdIds: string[] = [];
        for (const taskDef of evaluation.tasksToCreate) {
          const blockedBy = (taskDef.depends_on ?? [])
            .map((i: number) => createdIds[i])
            .filter(Boolean) as string[];
          const t = await createTask(conn, {
            name: taskDef.name,
            description: taskDef.description,
            priority: taskDef.priority,
            blocked_by: blockedBy,
          });
          createdIds.push(t.id);
          logger.success(`Created task: ${t.name} (${t.id})`);
        }
      }

      await markScheduleRun(conn, s.id);
      logger.info(`Marked schedule "${s.name}" as run.`);
      conn.close();
    });
}

function enabledColor(enabled: boolean): string {
  return enabled ? ansis.green("enabled") : ansis.dim("disabled");
}

function printSchedule(s: Schedule) {
  const id = ansis.dim(s.id.slice(0, 8));
  const lastRun = s.last_run_at
    ? s.last_run_at.toISOString()
    : ansis.dim("never");
  console.log(
    `  ${id}  ${enabledColor(s.enabled)}  ${s.frequency}  ${s.name}  (last: ${lastRun})`,
  );
}

function printScheduleDetail(s: Schedule) {
  console.log(ansis.bold(s.name));
  console.log(`  ID:          ${s.id}`);
  console.log(`  Status:      ${enabledColor(s.enabled)}`);
  console.log(`  Frequency:   ${s.frequency}`);
  if (s.description) console.log(`  Description: ${s.description}`);
  console.log(
    `  Last run:    ${s.last_run_at ? s.last_run_at.toISOString() : ansis.dim("never")}`,
  );
  console.log(`  Created:     ${s.created_at.toISOString()}`);
  console.log(`  Updated:     ${s.updated_at.toISOString()}`);
}
