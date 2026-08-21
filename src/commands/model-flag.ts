import { loadConfig } from "../config/loader.ts";
import { resolveModel } from "../config/models.ts";
import { logger } from "../utils/logger.ts";

/**
 * Validate a `--model` flag against the project's `models` registry, printing
 * the resolver's message (which lists every configured name) and exiting 1 on
 * a miss.
 *
 * Commands call this even when the code they delegate to validates again —
 * `startWorker` / `spawnWorker` / `runDream` all re-check for the benefit of
 * programmatic callers. Doing it here first is what turns an unhandled throw
 * with a stack trace into a one-line CLI error.
 *
 * Returns the resolved entry name so callers can report or display it.
 */
export async function assertModelFlag(
  projectDir: string,
  name: string | undefined,
): Promise<string | undefined> {
  if (!name) return undefined;
  try {
    return resolveModel(await loadConfig(projectDir), name).name;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
