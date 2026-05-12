import { homedir } from "node:os";
import { join } from "node:path";
import { MembotClient } from "membot";
import type { BotholomewConfig } from "../config/schemas.ts";

/**
 * Resolve the membot data directory for a project, honoring `membot_scope`:
 *   - "global"  → `~/.membot` (shared across all Botholomew projects)
 *   - "project" → `<projectDir>` (isolated per project)
 *
 * Membot's `configFlag` doubles as its data-dir flag (see
 * `node_modules/membot/src/config/loader.ts::resolveDataDir`): an explicit
 * value wins over `$MEMBOT_HOME` and the `~/.membot` default. We always pass
 * an explicit value so a stray `MEMBOT_HOME` cannot redirect Botholomew at a
 * different store.
 */
export function resolveMembotDir(
  projectDir: string,
  config: Pick<BotholomewConfig, "membot_scope">,
): string {
  return config.membot_scope === "project"
    ? projectDir
    : join(homedir(), ".membot");
}

/**
 * Open a membot client rooted at `dataDir`. The caller is responsible for
 * resolving the directory (via `resolveMembotDir`) and for `close()` on
 * shutdown.
 */
export function openMembot(dataDir: string): MembotClient {
  return new MembotClient({ configFlag: dataDir });
}
