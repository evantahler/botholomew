import ansis from "ansis";
import type { Command } from "commander";
import type { Schedule } from "../schedules/schema.ts";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  markScheduleRun,
  updateSchedule,
} from "../schedules/store.ts";
import { logger } from "../utils/logger.ts";

export function registerScheduleCommand(program: Command) {
  const schedule = program.command("schedule").description("Manage schedules");

  schedule
    .command("list")
    .description("List all schedules")
    .option("--enabled", "show only enabled schedules")
    .option("--disabled", "show only disabled schedules")
    .option("-l, --limit <n>", "max number of schedules", Number.parseInt)
    .option("-o, --offset <n>", "skip first N schedules", Number.parseInt)
    .action(async (opts) => {
      const dir = program.opts().dir;
      const filters: { enabled?: boolean; limit?: number; offset?: number } = {
        limit: opts.limit,
        offset: opts.offset,
      };
      if (opts.enabled) filters.enabled = true;
      if (opts.disabled) filters.enabled = false;

      const schedules = await listSchedules(dir, filters);
      if (schedules.length === 0) {
        logger.dim("No schedules found.");
        return;
      }
      for (const s of schedules) printSchedule(s);
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
      const s = await createSchedule(dir, {
        name,
        description: opts.description,
        frequency: opts.frequency,
      });
      logger.success(`Created schedule: ${s.name} (${s.id})`);
    });

  schedule
    .command("view <id>")
    .description("View schedule details")
    .action(async (id) => {
      const dir = program.opts().dir;
      const s = await getSchedule(dir, id);
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }
      printScheduleDetail(s);
    });

  schedule
    .command("enable <id>")
    .description("Enable a schedule")
    .action(async (id) => {
      const dir = program.opts().dir;
      const s = await updateSchedule(dir, id, { enabled: true });
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }
      logger.success(`Enabled schedule: ${s.name}`);
    });

  schedule
    .command("disable <id>")
    .description("Disable a schedule")
    .action(async (id) => {
      const dir = program.opts().dir;
      const s = await updateSchedule(dir, id, { enabled: false });
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }
      logger.success(`Disabled schedule: ${s.name}`);
    });

  schedule
    .command("delete <id>")
    .description("Delete a schedule")
    .action(async (id) => {
      const dir = program.opts().dir;
      const deleted = await deleteSchedule(dir, id);
      if (!deleted) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }
      logger.success(`Deleted schedule: ${id}`);
    });

  schedule
    .command("trigger <id>")
    .description("Manually trigger a schedule (creates tasks immediately)")
    .action(async (id) => {
      const dir = program.opts().dir;
      const s = await getSchedule(dir, id);
      if (!s) {
        logger.error(`Schedule not found: ${id}`);
        process.exit(1);
      }

      const { evaluateSchedule } = await import("../worker/schedules.ts");
      const { loadConfig } = await import("../config/loader.ts");
      const { createTask } = await import("../tasks/store.ts");

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
          const t = await createTask(dir, {
            name: taskDef.name,
            description: taskDef.description,
            priority: taskDef.priority,
            blocked_by: blockedBy,
          });
          createdIds.push(t.id);
          logger.success(`Created task: ${t.name} (${t.id})`);
        }
      }

      await markScheduleRun(dir, s.id);
      logger.info(`Marked schedule "${s.name}" as run.`);
    });
}

function enabledColor(enabled: boolean): string {
  return enabled ? ansis.green("enabled") : ansis.dim("disabled");
}

function printSchedule(s: Schedule) {
  const id = ansis.dim(s.id);
  const lastRun = s.last_run_at ?? ansis.dim("never");
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
  console.log(`  Last run:    ${s.last_run_at ?? ansis.dim("never")}`);
  console.log(`  Created:     ${s.created_at}`);
  console.log(`  Updated:     ${s.updated_at}`);
}
