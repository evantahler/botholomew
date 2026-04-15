import type { McpxClient } from "@evantahler/mcpx";
import type { ResolvedConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import {
  claimNextTask,
  resetStaleTasks,
  updateTaskStatus,
} from "../db/tasks.ts";
import { createThread, endThread, logInteraction } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";
import { runAgentLoop } from "./llm.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { processSchedules } from "./schedules.ts";

export async function tick(
  projectDir: string,
  conn: DbConnection,
  config: ResolvedConfig,
  mcpxClient?: McpxClient | null,
): Promise<void> {
  logger.debug("Tick starting...");

  // Reset stale tasks stuck in in_progress
  const resetIds = await resetStaleTasks(
    conn,
    config.max_tick_duration_seconds * 3,
  );
  if (resetIds.length > 0) {
    logger.warn(
      `Reset ${resetIds.length} stale task(s): ${resetIds.join(", ")}`,
    );
  }

  // Process schedules (may create new tasks)
  try {
    await processSchedules(conn, config);
  } catch (err) {
    logger.error(`Schedule processing failed: ${err}`);
  }

  // Claim a task
  const task = await claimNextTask(conn);
  if (!task) {
    logger.debug("No tasks to work on. Sleeping.");
    return;
  }

  logger.info(`Working on task: ${task.name} (${task.id})`);

  // Create a thread for this tick
  const threadId = await createThread(
    conn,
    "daemon_tick",
    task.id,
    `Working: ${task.name}`,
  );

  // Build system prompt (includes task-relevant context from embeddings)
  const systemPrompt = await buildSystemPrompt(projectDir, task, conn, config, {
    hasMcpTools: mcpxClient != null,
  });

  try {
    const result = await runAgentLoop({
      systemPrompt,
      task,
      config,
      conn,
      threadId,
      projectDir,
      mcpxClient,
    });

    // Update task status
    await updateTaskStatus(conn, task.id, result.status, result.reason);

    // Log the status change
    await logInteraction(conn, threadId, {
      role: "system",
      kind: "status_change",
      content: `Task ${task.id} -> ${result.status}${result.reason ? `: ${result.reason}` : ""}`,
    });

    logger.info(`Task ${task.id} -> ${result.status}`);
  } catch (err) {
    await updateTaskStatus(conn, task.id, "failed", String(err));

    await logInteraction(conn, threadId, {
      role: "system",
      kind: "status_change",
      content: `Task ${task.id} failed: ${err}`,
    });

    logger.error(`Task ${task.id} failed: ${err}`);
  } finally {
    await endThread(conn, threadId);
  }
}
