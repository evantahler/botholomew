import Anthropic from "@anthropic-ai/sdk";
import type { ResolvedConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import {
  listSchedules,
  markScheduleRun,
  type Schedule,
} from "../db/schedules.ts";
import { createTask } from "../db/tasks.ts";
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

export async function evaluateSchedule(
  config: ResolvedConfig,
  schedule: Schedule,
): Promise<ScheduleEvaluation> {
  const client = new Anthropic({
    apiKey: config.anthropic_api_key || undefined,
  });

  const systemPrompt = `You are a schedule evaluator. Given a recurring schedule, the current time, and when the schedule last ran, determine:
1. Whether the schedule is currently due to run
2. If due, what task(s) should be created

Respond with JSON only, no other text. Use this exact schema:
{
  "isDue": boolean,
  "reasoning": "brief explanation of why it is or is not due",
  "tasks": [
    {
      "name": "task name",
      "description": "what to do",
      "priority": "low" | "medium" | "high",
      "depends_on": []
    }
  ]
}

The "depends_on" array contains indices of other tasks in the array that must complete first. For example, if task at index 1 depends on task at index 0, set depends_on to [0].`;

  const userMessage = `Schedule: "${schedule.name}"
Description: ${schedule.description || "(none)"}
Frequency: ${schedule.frequency}
Last run: ${schedule.last_run_at?.toISOString() ?? "never"}
Current time: ${new Date().toISOString()}

Is this schedule due to run? If yes, what tasks should be created?`;

  try {
    const response = await client.messages.create({
      model: config.chunker_model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = JSON.parse(text);

    return {
      isDue: Boolean(parsed.isDue),
      reasoning: String(parsed.reasoning ?? ""),
      tasksToCreate: Array.isArray(parsed.tasks)
        ? parsed.tasks.map((t: Record<string, unknown>) => ({
            name: String(t.name ?? "Untitled"),
            description: String(t.description ?? ""),
            priority:
              t.priority === "low" || t.priority === "high"
                ? t.priority
                : "medium",
            depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
          }))
        : [],
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
  conn: DbConnection,
  config: ResolvedConfig,
): Promise<void> {
  const schedules = await listSchedules(conn, { enabled: true });
  if (schedules.length === 0) return;

  for (const schedule of schedules) {
    try {
      const evaluation = await evaluateSchedule(config, schedule);

      if (!evaluation.isDue) {
        logger.debug(
          `Schedule "${schedule.name}" not due: ${evaluation.reasoning}`,
        );
        continue;
      }

      const createdIds: string[] = [];
      for (const taskDef of evaluation.tasksToCreate) {
        const blockedBy = (taskDef.depends_on ?? [])
          .map((i: number) => createdIds[i])
          .filter(Boolean) as string[];

        const task = await createTask(conn, {
          name: taskDef.name,
          description: taskDef.description,
          priority: taskDef.priority,
          blocked_by: blockedBy,
        });
        createdIds.push(task.id);
      }

      await markScheduleRun(conn, schedule.id);
      logger.info(
        `Schedule "${schedule.name}" fired, created ${createdIds.length} task(s)`,
      );
    } catch (err) {
      logger.error(`Error processing schedule "${schedule.name}": ${err}`);
    }
  }
}
