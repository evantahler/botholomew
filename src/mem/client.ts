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

/**
 * A scope-bound membot accessor passed via `ToolContext.withMem`. Each call
 * runs `fn` with a live `MembotClient` and is responsible for whatever
 * open/close lifecycle is appropriate for the surrounding scope.
 */
export type WithMem = <T>(fn: (mem: MembotClient) => Promise<T>) => Promise<T>;

/**
 * Build a `WithMem` that forwards to an already-open client, **serializing**
 * concurrent callers through a per-client queue. Used inside a chat turn or
 * worker tick that opens membot once and shares it across all tool calls
 * within that scope.
 *
 * Why serialize: every `MembotClient.<op>` releases the underlying DuckDB
 * instance in `finally` (so other processes can grab the file lock). When
 * two ops run on the same client in parallel via `Promise.all`, the first to
 * finish closes the connection out from under the slower one, and the slower
 * op's next query hangs on a disposed handle. Queuing here keeps the "many
 * parallel tool calls in one chat turn" pattern correct without forcing
 * unrelated (non-membot) tool calls to serialize.
 */
export function sharedWithMem(mem: MembotClient): WithMem {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: (m: MembotClient) => Promise<T>): Promise<T> => {
    const result = queue.then(() => fn(mem));
    // One failed op shouldn't poison the rest of the queue.
    queue = result.catch(() => {});
    return result as Promise<T>;
  };
}

/**
 * Build a `WithMem` that opens a fresh `MembotClient` per call, runs `fn`,
 * and closes it in `finally`. Used in sparse, user-triggered contexts (e.g.
 * the TUI ContextPanel) where holding the DuckDB file lock between ops would
 * block other Botholomew processes from the shared `~/.membot` store.
 */
export function scopedWithMem(dataDir: string): WithMem {
  return async (fn) => {
    const mem = openMembot(dataDir);
    try {
      await mem.connect();
      return await fn(mem);
    } finally {
      await mem.close();
    }
  };
}
