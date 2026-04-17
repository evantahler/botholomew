import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import { withDb } from "../db/connection.ts";
import {
  claimNextTask,
  resetStaleTasks,
  updateTaskStatus,
} from "../db/tasks.ts";
import { createThread, endThread, logInteraction } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";
import { generateThreadTitle } from "../utils/title.ts";
import type { DaemonStreamCallbacks } from "./llm.ts";
import { runAgentLoop } from "./llm.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { processSchedules } from "./schedules.ts";

export async function tick(
  projectDir: string,
  dbPath: string,
  config: Required<BotholomewConfig>,
  mcpxClient?: McpxClient | null,
  callbacks?: DaemonStreamCallbacks,
): Promise<boolean> {
  logger.debug("Tick starting...");

  // Reset stale tasks stuck in in_progress
  const resetIds = await withDb(dbPath, (conn) =>
    resetStaleTasks(conn, config.max_tick_duration_seconds * 3),
  );
  if (resetIds.length > 0) {
    logger.warn(
      `Reset ${resetIds.length} stale task(s): ${resetIds.join(", ")}`,
    );
  }

  // Process schedules (may create new tasks)
  try {
    await processSchedules(dbPath, config);
  } catch (err) {
    logger.error(`Schedule processing failed: ${err}`);
  }

  // Claim a task
  const task = await withDb(dbPath, (conn) => claimNextTask(conn));
  if (!task) {
    logger.debug("No tasks to work on. Sleeping.");
    return false;
  }

  logger.info(`Working on task: ${task.name} (${task.id})`);
  callbacks?.onTaskStart(task);

  // Create a thread for this tick
  const threadId = await withDb(dbPath, (conn) =>
    createThread(conn, "daemon_tick", task.id, `Working: ${task.name}`),
  );

  // Build system prompt (includes task-relevant context from embeddings)
  const systemPrompt = await buildSystemPrompt(
    projectDir,
    task,
    dbPath,
    config,
    {
      hasMcpTools: mcpxClient != null,
    },
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

    // Update task status and store output
    await withDb(dbPath, (conn) =>
      updateTaskStatus(
        conn,
        task.id,
        result.status,
        result.reason,
        result.reason,
      ),
    );

    // Log the status change
    await withDb(dbPath, (conn) =>
      logInteraction(conn, threadId, {
        role: "system",
        kind: "status_change",
        content: `Task ${task.id} -> ${result.status}${result.reason ? `: ${result.reason}` : ""}`,
      }),
    );

    logger.info(`Task ${task.id} -> ${result.status}`);

    // Generate a descriptive title for the thread (fire-and-forget)
    void generateThreadTitle(
      config,
      dbPath,
      threadId,
      `Task: ${task.name}\nDescription: ${task.description}\nOutcome: ${result.status}${result.reason ? ` — ${result.reason}` : ""}`,
    );
  } catch (err) {
    await withDb(dbPath, (conn) =>
      updateTaskStatus(conn, task.id, "failed", String(err), String(err)),
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

  return true;
}
