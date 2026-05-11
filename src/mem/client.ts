import { MembotClient } from "membot";

/**
 * Open a per-project membot client. Each Botholomew project gets its own
 * membot data dir (`<projectDir>/config.json` + `<projectDir>/index.duckdb`)
 * so projects don't share knowledge. The caller is responsible for `close()`
 * on shutdown.
 *
 * Membot's `configFlag` doubles as its data-dir flag (see
 * `membot/src/config/loader.ts::resolveDataDir`): an explicit value wins over
 * `$MEMBOT_HOME` and the `~/.membot` default. We pass the project directory
 * unconditionally so a stray `MEMBOT_HOME` in the user's environment cannot
 * redirect Botholomew at a different store.
 */
export function openMembot(projectDir: string): MembotClient {
  return new MembotClient({ configFlag: projectDir });
}
