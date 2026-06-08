import { getTask, updateTaskStatus } from "../tasks/store.ts";
import { logger } from "../utils/logger.ts";
import type { Approval } from "./schema.ts";
import { decideApproval, getApproval } from "./store.ts";

/**
 * Apply a human decision to a pending approval and re-queue its originating
 * task. Shared by the CLI (`botholomew approval approve|deny`) and the chat
 * TUI approvals panel so both behave identically:
 *   - mark the record approved/denied,
 *   - flip the parked task back to `pending` so a worker re-claims it; on the
 *     re-run the recorded decision short-circuits the gated call.
 *
 * Returns the updated approval, or null if it didn't exist / wasn't pending.
 */
export async function decideAndRequeue(
  projectDir: string,
  id: string,
  decision: "approved" | "denied",
  decidedBy: string,
): Promise<Approval | null> {
  const existing = await getApproval(projectDir, id);
  if (!existing || existing.status !== "pending") return null;
  const decided = await decideApproval(projectDir, id, decision, decidedBy);
  if (decided.task_id) {
    const task = await getTask(projectDir, decided.task_id);
    if (task) {
      await updateTaskStatus(projectDir, decided.task_id, "pending");
    } else {
      logger.warn(
        `Originating task ${decided.task_id} no longer exists; not re-queued.`,
      );
    }
  }
  return decided;
}
