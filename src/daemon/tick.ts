import type { BotholomewConfig } from "../config/schemas.ts";
import type { DuckDBConnection } from "../db/connection.ts";
import { claimNextTask, updateTaskStatus } from "../db/tasks.ts";
import { createThread, endThread, logInteraction } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";
import { runAgentLoop } from "./llm.ts";
import { buildSystemPrompt } from "./prompt.ts";

export async function tick(
  projectDir: string,
  conn: DuckDBConnection,
  config: Required<BotholomewConfig>,
): Promise<void> {
  logger.debug("Tick starting...");

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

  // Build system prompt
  const systemPrompt = await buildSystemPrompt(projectDir);

  try {
    const result = await runAgentLoop({
      systemPrompt,
      task,
      config,
      conn,
      threadId,
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
