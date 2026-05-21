import { generateObject } from "ai";
import { z } from "zod";
import type { BotholomewConfig } from "../config/schemas.ts";
import {
  buildProviderOptions,
  getLanguageModel,
  getMaxInputTokens,
} from "../llm/index.ts";
import type { Schedule } from "../schedules/schema.ts";
import {
  listSchedules,
  markScheduleRun,
  withScheduleLock,
} from "../schedules/store.ts";
import { createTask } from "../tasks/store.ts";
import { logger } from "../utils/logger.ts";

interface ScheduleTaskDef {
  name: string;
  description: string;
  priority: "low" | "medium" | "high";
  depends_on?: number[];
}

export interface ScheduleEvaluation {
  isDue: boolean;
  reasoning: string;
  tasksToCreate: ScheduleTaskDef[];
}

const ScheduleResponseSchema = z.object({
  isDue: z.boolean(),
  reasoning: z.string(),
  tasks: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      priority: z.enum(["low", "medium", "high"]),
      depends_on: z.array(z.number()).optional(),
    }),
  ),
});

export async function evaluateSchedule(
  config: BotholomewConfig,
  schedule: Schedule,
): Promise<ScheduleEvaluation> {
  const model = getLanguageModel(config.chunker_llm);
  const numCtx = await getMaxInputTokens(config.chunker_llm);

  const systemPrompt = `You are a schedule evaluator. Given a recurring schedule, the current time, and when the schedule last ran, determine:
1. Whether the schedule is currently due to run
2. If due, what task(s) should be created

For each task, "depends_on" is an array of indices of earlier tasks in your output that must complete before this one runs (e.g. if task index 1 depends on task index 0, set depends_on to [0]).`;

  const userMessage = `Schedule: "${schedule.name}"
Description: ${schedule.description || "(none)"}
Frequency: ${schedule.frequency}
Last run: ${schedule.last_run_at ?? "never"}
Current time: ${new Date().toISOString()}

Is this schedule due to run? If yes, what tasks should be created?`;

  try {
    const { object } = await generateObject({
      model,
      schema: ScheduleResponseSchema,
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 1024,
      providerOptions: buildProviderOptions(config.chunker_llm, numCtx),
    });

    return {
      isDue: object.isDue,
      reasoning: object.reasoning,
      tasksToCreate: object.tasks.map((t) => ({
        name: t.name,
        description: t.description,
        priority: t.priority,
        depends_on: t.depends_on ?? [],
      })),
    };
  } catch (err) {
    logger.warn(`Failed to evaluate schedule "${schedule.name}": ${err}`);
    return {
      isDue: false,
      reasoning: `Evaluation failed: ${err}`,
      tasksToCreate: [],
    };
  }
}

export async function processSchedules(
  projectDir: string,
  config: BotholomewConfig,
  workerId: string,
): Promise<void> {
  const schedules = await listSchedules(projectDir, { enabled: true });
  if (schedules.length === 0) return;

  logger.phase("evaluating-schedules", `${schedules.length} enabled`);

  for (const schedule of schedules) {
    await withScheduleLock(
      projectDir,
      schedule.id,
      workerId,
      { minIntervalSeconds: config.schedule_min_interval_seconds },
      async (claimed) => {
        try {
          const evaluation = await evaluateSchedule(config, claimed);

          if (!evaluation.isDue) {
            logger.debug(
              `Schedule "${claimed.name}" not due: ${evaluation.reasoning}`,
            );
            return;
          }

          const createdIds: string[] = [];
          for (const taskDef of evaluation.tasksToCreate) {
            const blockedBy = (taskDef.depends_on ?? [])
              .map((i: number) => createdIds[i])
              .filter(Boolean) as string[];

            const task = await createTask(projectDir, {
              name: taskDef.name,
              description: taskDef.description,
              priority: taskDef.priority,
              blocked_by: blockedBy,
            });
            createdIds.push(task.id);
          }

          await markScheduleRun(projectDir, claimed.id);
          logger.info(
            `Schedule "${claimed.name}" fired, created ${createdIds.length} task(s)`,
          );
        } catch (err) {
          logger.error(`Error processing schedule "${claimed.name}": ${err}`);
        }
      },
    );
  }
}
