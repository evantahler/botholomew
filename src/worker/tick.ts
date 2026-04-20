import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import { withDb } from "../db/connection.ts";
import {
  claimNextTask,
  claimSpecificTask,
  resetStaleTasks,
  type Task,
  updateTaskStatus,
} from "../db/tasks.ts";
import { createThread, endThread, logInteraction } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";
import { generateThreadTitle } from "../utils/title.ts";
import type { WorkerStreamCallbacks } from "./llm.ts";
import { runAgentLoop } from "./llm.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { processSchedules } from "./schedules.ts";

export interface TickOptions {
  projectDir: string;
  dbPath: string;
  config: Required<BotholomewConfig>;
  workerId: string;
  mcpxClient?: McpxClient | null;
  callbacks?: WorkerStreamCallbacks;
  tickNum?: number;
  evalSchedules?: boolean;
}

/**
 * Run one unit of work for a worker: optionally evaluate schedules, claim
 * the next eligible task, and process it. Returns true if work was done.
 */
export async function tick(opts: TickOptions): Promise<boolean> {
  const {
    projectDir,
    dbPath,
    config,
    workerId,
    mcpxClient,
    callbacks,
    tickNum = 1,
    evalSchedules = true,
  } = opts;

  const tickStart = Date.now();
  logger.phase("tick-start", `#${tickNum}`);

  // Reset stale tasks stuck in in_progress
  const resetIds = await withDb(dbPath, (conn) =>
    resetStaleTasks(conn, config.max_tick_duration_seconds * 3),
  );
  if (resetIds.length > 0) {
    logger.warn(
      `Reset ${resetIds.length} stale task(s): ${resetIds.join(", ")}`,
    );
  }

  if (evalSchedules) {
    try {
      await processSchedules(dbPath, config, workerId);
    } catch (err) {
      logger.error(`Schedule processing failed: ${err}`);
    }
  }

  // Claim a task
  logger.phase("claiming-task");
  const task = await withDb(dbPath, (conn) => claimNextTask(conn, workerId));
  if (!task) {
    logger.info("No task claimed (queue empty or all blocked)");
    const elapsed = ((Date.now() - tickStart) / 1000).toFixed(1);
    logger.phase("tick-end", `#${tickNum} ${elapsed}s didWork=false`);
    return false;
  }

  await runClaimedTask({
    projectDir,
    dbPath,
    config,
    mcpxClient,
    callbacks,
    task,
  });

  const elapsed = ((Date.now() - tickStart) / 1000).toFixed(1);
  logger.phase("tick-end", `#${tickNum} ${elapsed}s didWork=true`);
  return true;
}

/**
 * Claim and run a single, explicitly-named task. Returns true if the task
 * was claimed and processed, false if it wasn't eligible (already claimed,
 * not pending, or doesn't exist).
 */
export async function runSpecificTask(opts: {
  projectDir: string;
  dbPath: string;
  config: Required<BotholomewConfig>;
  workerId: string;
  taskId: string;
  mcpxClient?: McpxClient | null;
  callbacks?: WorkerStreamCallbacks;
}): Promise<boolean> {
  const task = await withDb(opts.dbPath, (conn) =>
    claimSpecificTask(conn, opts.taskId, opts.workerId),
  );
  if (!task) {
    logger.warn(
      `Task ${opts.taskId} is not available (already claimed, not pending, or missing)`,
    );
    return false;
  }
  await runClaimedTask({
    projectDir: opts.projectDir,
    dbPath: opts.dbPath,
    config: opts.config,
    mcpxClient: opts.mcpxClient,
    callbacks: opts.callbacks,
    task,
  });
  return true;
}

async function runClaimedTask(opts: {
  projectDir: string;
  dbPath: string;
  config: Required<BotholomewConfig>;
  mcpxClient?: McpxClient | null;
  callbacks?: WorkerStreamCallbacks;
  task: Task;
}): Promise<void> {
  const { projectDir, dbPath, config, mcpxClient, callbacks, task } = opts;

  logger.info(`Claimed task: ${task.name} (${task.id})`);
  callbacks?.onTaskStart(task);

  const threadId = await withDb(dbPath, (conn) =>
    createThread(conn, "worker_tick", task.id, `Working: ${task.name}`),
  );

  const systemPrompt = await buildSystemPrompt(
    projectDir,
    task,
    dbPath,
    config,
    { hasMcpTools: mcpxClient != null },
  );

  try {
    const result = await runAgentLoop({
      systemPrompt,
      task,
      config,
      dbPath,
      threadId,
      projectDir,
      mcpxClient,
      callbacks,
    });

    const isComplete = result.status === "complete";
    await withDb(dbPath, (conn) =>
      updateTaskStatus(
        conn,
        task.id,
        result.status,
        isComplete ? null : result.reason,
        isComplete ? result.reason : null,
      ),
    );

    await withDb(dbPath, (conn) =>
      logInteraction(conn, threadId, {
        role: "system",
        kind: "status_change",
        content: `Task ${task.id} -> ${result.status}${result.reason ? `: ${result.reason}` : ""}`,
      }),
    );

    logger.info(`Task ${task.id} -> ${result.status}`);

    void generateThreadTitle(
      config,
      dbPath,
      threadId,
      `Task: ${task.name}\nDescription: ${task.description}\nOutcome: ${result.status}${result.reason ? ` — ${result.reason}` : ""}`,
    );
  } catch (err) {
    await withDb(dbPath, (conn) =>
      updateTaskStatus(conn, task.id, "failed", String(err), null),
    );

    await withDb(dbPath, (conn) =>
      logInteraction(conn, threadId, {
        role: "system",
        kind: "status_change",
        content: `Task ${task.id} failed: ${err}`,
      }),
    );

    logger.error(`Task ${task.id} failed: ${err}`);
  } finally {
    await withDb(dbPath, (conn) => endThread(conn, threadId));
  }
}
