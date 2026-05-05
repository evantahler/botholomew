import { reapOrphanScheduleLocks } from "../schedules/store.ts";
import { reapOrphanLocks as reapOrphanTaskLocks } from "../tasks/store.ts";
import { logger } from "../utils/logger.ts";
import {
  heartbeat,
  isWorkerRunning,
  pruneStoppedWorkers,
  reapDeadWorkers,
} from "../workers/store.ts";

/**
 * Start a non-blocking heartbeat interval for a running worker. Each tick
 * atomically rewrites `<projectDir>/workers/<id>.json` with an updated
 * `last_heartbeat_at`. The setInterval handle is unref'd so the heartbeat
 * doesn't keep the Bun event loop alive on its own.
 */
export function startHeartbeat(
  projectDir: string,
  workerId: string,
  intervalSeconds: number,
): () => void {
  const ms = Math.max(1_000, intervalSeconds * 1_000);
  const handle = setInterval(async () => {
    try {
      await heartbeat(projectDir, workerId);
    } catch (err) {
      logger.warn(`worker heartbeat failed: ${err}`);
    }
  }, ms);
  handle.unref?.();
  return () => clearInterval(handle);
}

/**
 * Periodic reaper: walk `workers/`, mark any running worker dead whose
 * heartbeat is older than `staleAfterSeconds`, then walk `tasks/.locks/`
 * and `schedules/.locks/` and unlink any lockfile whose holder is no
 * longer running. Cleanly-stopped worker JSON files older than
 * `stoppedRetentionSeconds` are pruned.
 */
export function startReaper(
  projectDir: string,
  intervalSeconds: number,
  staleAfterSeconds: number,
  stoppedRetentionSeconds: number,
): () => void {
  const ms = Math.max(1_000, intervalSeconds * 1_000);
  const handle = setInterval(async () => {
    try {
      const reaped = await reapDeadWorkers(projectDir, staleAfterSeconds);
      if (reaped.length > 0) {
        logger.warn(
          `reaped ${reaped.length} stale worker(s): ${reaped.join(", ")}`,
        );
      }
    } catch (err) {
      logger.warn(`worker reap failed: ${err}`);
    }

    const isAlive = (id: string) => isWorkerRunning(projectDir, id);

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
      const pruned = await pruneStoppedWorkers(
        projectDir,
        stoppedRetentionSeconds,
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
