import type { ToolApprovalCallback } from "@evantahler/mcpx";
import { ApprovalPendingError } from "../approvals/errors.ts";
import {
  callKey,
  consumeApproval,
  createApproval,
  findByCallKey,
} from "../approvals/store.ts";

/**
 * Mutable, per-worker holder for the task/thread currently being processed.
 * The worker shares one long-lived `McpxClient` across ticks, so its approval
 * callback can't close over a single task — it reads the current task/thread
 * from this holder, which `runClaimedTask` updates before each agent loop.
 * Ticks are sequential per worker, so there's no race.
 */
export interface WorkerApprovalCtx {
  taskId: string | null;
  threadId: string | null;
}

/**
 * Build the worker's `onApprovalRequired` callback. A worker can't prompt a
 * human, so it resolves a gated mcpx call against the on-disk approval queue:
 *   - an existing **approved** record → consume it and allow the call,
 *   - an existing **denied** record → return false (mcpx throws ToolApprovalDeniedError),
 *   - a **pending** record → throw ApprovalPendingError (task parks, stays queued),
 *   - **no record** → write a pending `approvals/<id>.md` and throw ApprovalPendingError.
 */
export function makeWorkerApprovalCallback(
  projectDir: string,
  workerId: string,
  ctx: WorkerApprovalCtx,
): ToolApprovalCallback {
  return async ({ server, tool, args, reason }) => {
    const key = callKey(server, tool, args);
    const existing = await findByCallKey(projectDir, key);
    if (existing) {
      if (existing.status === "approved") {
        await consumeApproval(projectDir, existing.id);
        return true;
      }
      if (existing.status === "denied") {
        return false;
      }
      // pending — already queued, still awaiting a human decision.
      throw new ApprovalPendingError(existing.id, server, tool);
    }
    const created = await createApproval(projectDir, {
      server,
      tool,
      args,
      reason,
      task_id: ctx.taskId,
      thread_id: ctx.threadId,
      worker_id: workerId,
    });
    throw new ApprovalPendingError(created.id, server, tool);
  };
}
