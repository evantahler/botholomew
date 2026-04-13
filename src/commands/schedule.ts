import ansis from "ansis";
import type { Command } from "commander";
import type { Schedule } from "../db/schedules.ts";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
} from "../db/schedules.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

export function registerScheduleCommand(program: Command) {
  const schedule = program.command("schedule").description("Manage schedules");

  schedule
    .command("list")
    .description("List all schedules")
    .option("--enabled", "show only enabled schedules")
    .option("--disabled", "show only disabled schedules")
    .action((opts) =>
      withDb(program, async (conn) => {
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
      }),
    );

  schedule
    .command("add <name>")
    .description("Create a new schedule")
    .requiredOption(
      "-f, --frequency <text>",
      "how often to run (e.g. 'every morning')",
    )
    .option("--description <text>", "schedule description", "")
    .action((name, opts) =>
      withDb(program, async (conn) => {
        const s = await createSchedule(conn, {
          name,
          description: opts.description,
          frequency: opts.frequency,
        });
        logger.success(`Created schedule: ${s.name} (${s.id})`);
      }),
    );

  schedule
    .command("view <id>")
    .description("View schedule details")
    .action((id) =>
      withDb(program, async (conn) => {
        const s = await getSchedule(conn, id);
        if (!s) {
          logger.error(`Schedule not found: ${id}`);
          process.exit(1);
        }
        printScheduleDetail(s);
      }),
    );

  schedule
    .command("enable <id>")
    .description("Enable a schedule")
    .action((id) =>
      withDb(program, async (conn) => {
        const s = await updateSchedule(conn, id, { enabled: true });
        if (!s) {
          logger.error(`Schedule not found: ${id}`);
          process.exit(1);
        }
        logger.success(`Enabled schedule: ${s.name}`);
      }),
    );

  schedule
    .command("disable <id>")
    .description("Disable a schedule")
    .action((id) =>
      withDb(program, async (conn) => {
        const s = await updateSchedule(conn, id, { enabled: false });
        if (!s) {
          logger.error(`Schedule not found: ${id}`);
          process.exit(1);
        }
        logger.success(`Disabled schedule: ${s.name}`);
      }),
    );

  schedule
    .command("delete <id>")
    .description("Delete a schedule")
    .action((id) =>
      withDb(program, async (conn) => {
        const deleted = await deleteSchedule(conn, id);
        if (!deleted) {
          logger.error(`Schedule not found: ${id}`);
          process.exit(1);
        }
        logger.success(`Deleted schedule: ${id}`);
      }),
    );

  schedule
    .command("trigger <id>")
    .description("Manually trigger a schedule (creates tasks immediately)")
    .action((id) =>
      withDb(program, async (conn, dir) => {
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
      }),
    );
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
