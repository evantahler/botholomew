import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import {
  openMembot,
  resolveMembotDir,
  sharedWithMem,
  type WithMem,
} from "../mem/client.ts";
import type { Task } from "../tasks/schema.ts";
import {
  claimNextTask,
  claimSpecificTask,
  releaseTaskLock,
  resetStaleTasks,
  updateTaskStatus,
} from "../tasks/store.ts";
import { createThread, endThread, logInteraction } from "../threads/store.ts";
import { logger } from "../utils/logger.ts";
import { generateThreadTitle } from "../utils/title.ts";
import type { WorkerApprovalCtx } from "./approval.ts";
import type { WorkerStreamCallbacks } from "./llm.ts";
import { runAgentLoop } from "./llm.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { processSchedules } from "./schedules.ts";

export interface TickOptions {
  projectDir: string;
  config: BotholomewConfig;
  workerId: string;
  mcpxClient?: McpxClient | null;
  callbacks?: WorkerStreamCallbacks;
  tickNum?: number;
  evalSchedules?: boolean;
  /** Holder the mcpx approval callback reads; set per-task before the loop. */
  approvalCtx?: WorkerApprovalCtx;
}

/**
 * Run one unit of work for a worker: optionally evaluate schedules, claim
 * the next eligible task, and process it. Returns true if work was done.
 *
 * Opens a membot client for the duration of this tick and closes it on the
 * way out so the DuckDB file lock is released between ticks — other
 * Botholomew processes (other workers, chat, the membot CLI) can read the
 * shared `~/.membot` store while this worker is idle.
 */
export async function tick(opts: TickOptions): Promise<boolean> {
  const {
    projectDir,
    config,
    workerId,
    mcpxClient,
    callbacks,
    tickNum = 1,
    evalSchedules = true,
    approvalCtx,
  } = opts;

  const tickStart = Date.now();
  logger.phase("tick-start", `#${tickNum}`);

  const resetIds = await resetStaleTasks(
    projectDir,
    config.max_tick_duration_seconds * 3,
  );
  if (resetIds.length > 0) {
    logger.warn(
      `Reset ${resetIds.length} stale task(s): ${resetIds.join(", ")}`,
    );
  }

  if (evalSchedules) {
    try {
      await processSchedules(projectDir, config, workerId);
    } catch (err) {
      logger.error(`Schedule processing failed: ${err}`);
    }
  }

  logger.phase("claiming-task");
  const task = await claimNextTask(projectDir, workerId);
  if (!task) {
    logger.info("No task claimed (queue empty or all blocked)");
    const elapsed = ((Date.now() - tickStart) / 1000).toFixed(1);
    logger.phase("tick-end", `#${tickNum} ${elapsed}s didWork=false`);
    return false;
  }

  const mem = openMembot(resolveMembotDir(projectDir, config));
  await mem.connect();
  try {
    await runClaimedTask({
      projectDir,
      withMem: sharedWithMem(mem),
      config,
      workerId,
      mcpxClient,
      callbacks,
      task,
      approvalCtx,
    });
  } finally {
    await mem.close();
  }

  const elapsed = ((Date.now() - tickStart) / 1000).toFixed(1);
  logger.phase("tick-end", `#${tickNum} ${elapsed}s didWork=true`);
  return true;
}

/**
 * Claim and run a single, explicitly-named task. Returns true if the task
 * was claimed and processed, false if it wasn't eligible.
 */
export async function runSpecificTask(opts: {
  projectDir: string;
  config: BotholomewConfig;
  workerId: string;
  taskId: string;
  mcpxClient?: McpxClient | null;
  callbacks?: WorkerStreamCallbacks;
  approvalCtx?: WorkerApprovalCtx;
}): Promise<boolean> {
  const task = await claimSpecificTask(
    opts.projectDir,
    opts.taskId,
    opts.workerId,
  );
  if (!task) {
    logger.warn(
      `Task ${opts.taskId} is not available (already claimed, not pending, or missing)`,
    );
    return false;
  }
  const mem = openMembot(resolveMembotDir(opts.projectDir, opts.config));
  await mem.connect();
  try {
    await runClaimedTask({
      projectDir: opts.projectDir,
      withMem: sharedWithMem(mem),
      config: opts.config,
      workerId: opts.workerId,
      mcpxClient: opts.mcpxClient,
      callbacks: opts.callbacks,
      task,
      approvalCtx: opts.approvalCtx,
    });
  } finally {
    await mem.close();
  }
  return true;
}

async function runClaimedTask(opts: {
  projectDir: string;
  withMem: WithMem;
  config: BotholomewConfig;
  workerId: string;
  mcpxClient?: McpxClient | null;
  callbacks?: WorkerStreamCallbacks;
  task: Task;
  approvalCtx?: WorkerApprovalCtx;
}): Promise<void> {
  const {
    projectDir,
    withMem,
    config,
    workerId,
    mcpxClient,
    callbacks,
    task,
    approvalCtx,
  } = opts;

  logger.info(`Claimed task: ${task.name} (${task.id})`);
  if (!callbacks && task.description) {
    logger.dim(task.description);
  }
  callbacks?.onTaskStart(task);

  const threadId = await createThread(
    projectDir,
    "worker_tick",
    task.id,
    `Working: ${task.name}`,
  );

  // Point the (shared) mcpx approval callback at this task/thread so any
  // approval record it writes is attributable and the task can be re-queued.
  if (approvalCtx) {
    approvalCtx.taskId = task.id;
    approvalCtx.threadId = threadId;
  }

  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemPrompt(projectDir, task, config, {
      hasMcpTools: mcpxClient != null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await updateTaskStatus(projectDir, task.id, "failed", reason, null);
    await logInteraction(projectDir, threadId, {
      role: "system",
      kind: "status_change",
      content: `Task ${task.id} failed during prompt load: ${reason}`,
    });
    logger.error(`Task ${task.id} failed during prompt load: ${reason}`);
    return;
  }

  try {
    const result = await runAgentLoop({
      systemPrompt,
      task,
      config,
      withMem,
      threadId,
      projectDir,
      workerId,
      mcpxClient,
      callbacks,
    });

    const isComplete = result.status === "complete";
    await updateTaskStatus(
      projectDir,
      task.id,
      result.status,
      isComplete ? null : result.reason,
      isComplete ? result.reason : null,
    );

    await logInteraction(projectDir, threadId, {
      role: "system",
      kind: "status_change",
      content: `Task ${task.id} -> ${result.status}${result.reason ? `: ${result.reason}` : ""}`,
    });

    logger.info(`Task ${task.id} -> ${result.status}`);

    void generateThreadTitle(
      config,
      projectDir,
      threadId,
      `Task: ${task.name}\nDescription: ${task.description}\nOutcome: ${result.status}${result.reason ? ` — ${result.reason}` : ""}`,
    );
  } catch (err) {
    await updateTaskStatus(projectDir, task.id, "failed", String(err), null);

    await logInteraction(projectDir, threadId, {
      role: "system",
      kind: "status_change",
      content: `Task ${task.id} failed: ${err}`,
    });

    logger.error(`Task ${task.id} failed: ${err}`);
  } finally {
    await releaseTaskLock(projectDir, task.id);
    await endThread(projectDir, threadId);
  }
}
