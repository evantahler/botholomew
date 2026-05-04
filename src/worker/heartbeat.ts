import { withDb } from "../db/connection.ts";
import {
  heartbeat,
  isWorkerRunning,
  pruneStoppedWorkers,
  reapDeadWorkers,
} from "../db/workers.ts";
import { reapOrphanScheduleLocks } from "../schedules/store.ts";
import { reapOrphanLocks as reapOrphanTaskLocks } from "../tasks/store.ts";
import { logger } from "../utils/logger.ts";

/**
 * Start a non-blocking heartbeat interval for a running worker.
 *
 * The heartbeat runs on its own `setInterval` timer so it stays live even
 * while the worker is blocked inside a long LLM call. We `unref` the timer
 * so it doesn't keep the Bun event loop alive on its own — the main tick
 * loop (or the awaited one-shot task) is what keeps the process running.
 */
export function startHeartbeat(
  dbPath: string,
  workerId: string,
  intervalSeconds: number,
): () => void {
  const ms = Math.max(1_000, intervalSeconds * 1_000);
  const handle = setInterval(async () => {
    try {
      await withDb(dbPath, (conn) => heartbeat(conn, workerId));
    } catch (err) {
      logger.warn(`worker heartbeat failed: ${err}`);
    }
  }, ms);
  handle.unref?.();
  return () => clearInterval(handle);
}

/**
 * Start a periodic reaper. Marks stale workers dead in the workers table,
 * then walks tasks/.locks and schedules/.locks and unlinks any lockfile
 * whose holder is dead. The next tick reclaims those tasks/schedules.
 */
export function startReaper(
  dbPath: string,
  projectDir: string,
  intervalSeconds: number,
  staleAfterSeconds: number,
  stoppedRetentionSeconds: number,
): () => void {
  const ms = Math.max(1_000, intervalSeconds * 1_000);
  const handle = setInterval(async () => {
    try {
      const reaped = await withDb(dbPath, (conn) =>
        reapDeadWorkers(conn, staleAfterSeconds),
      );
      if (reaped.length > 0) {
        logger.warn(
          `reaped ${reaped.length} stale worker(s): ${reaped.join(", ")}`,
        );
      }
    } catch (err) {
      logger.warn(`worker reap failed: ${err}`);
    }

    const isAlive = async (id: string) =>
      withDb(dbPath, (conn) => isWorkerRunning(conn, id));

    try {
      const released = await reapOrphanTaskLocks(projectDir, isAlive);
      if (released.length > 0) {
        logger.warn(
          `released ${released.length} orphan task lock(s): ${released.join(", ")}`,
        );
      }
    } catch (err) {
      logger.warn(`task lock reap failed: ${err}`);
    }

    try {
      const released = await reapOrphanScheduleLocks(projectDir, isAlive);
      if (released.length > 0) {
        logger.warn(
          `released ${released.length} orphan schedule lock(s): ${released.join(", ")}`,
        );
      }
    } catch (err) {
      logger.warn(`schedule lock reap failed: ${err}`);
    }

    try {
      const pruned = await withDb(dbPath, (conn) =>
        pruneStoppedWorkers(conn, stoppedRetentionSeconds),
      );
      if (pruned.length > 0) {
        logger.debug(
          `pruned ${pruned.length} old stopped worker(s): ${pruned.join(", ")}`,
        );
      }
    } catch (err) {
      logger.warn(`worker prune failed: ${err}`);
    }
  }, ms);
  handle.unref?.();
  return () => clearInterval(handle);
}
