import { withDb } from "../db/connection.ts";
import { heartbeat, reapDeadWorkers } from "../db/workers.ts";
import { logger } from "../utils/logger.ts";

/**
 * Start a non-blocking heartbeat interval for a running worker.
 *
 * The heartbeat runs on its own `setInterval` timer so it stays live even
 * while the worker is blocked inside a long LLM call. We `unref` the timer
 * so it doesn't keep the Bun event loop alive on its own — the main tick
 * loop (or the awaited one-shot task) is what keeps the process running.
 *
 * Errors are swallowed with a warning: a transient DB lock shouldn't crash
 * a worker that's otherwise doing useful work. If every heartbeat fails the
 * worker will eventually be reaped, which is the correct outcome.
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
 * Start a periodic reaper that marks stale workers dead and releases any
 * tasks / schedule claims they held. Only persist workers need this — a
 * one-shot worker does a single reap pass before claiming its task.
 */
export function startReaper(
  dbPath: string,
  intervalSeconds: number,
  staleAfterSeconds: number,
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
  }, ms);
  handle.unref?.();
  return () => clearInterval(handle);
}
