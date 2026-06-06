// Runtime-environment detection shared across the CLI.

/**
 * True when running as a `bun build --compile` standalone binary rather than
 * under the `bun` runtime (`bun run …` in dev, or the `bun install -g` shim).
 *
 * In a compiled binary `process.execPath` is the binary itself (e.g.
 * `…/dist/bothy`); under Bun it is the `bun`/`bunx` executable. Several code
 * paths must behave differently in a binary: there is no source tree or
 * `node_modules` on disk, so we can't `bun run` a `.ts` worker entry and must
 * instead re-exec the binary, and the embedder must stay in-process (no
 * subprocess pool) since the pool would re-exec an unknown sentinel arg.
 */
export const IS_COMPILED_BINARY = !/[\\/]bunx?(\.exe)?$/i.test(
  process.execPath,
);

/**
 * Sentinels the compiled binary re-execs itself with to run a bundled upstream
 * CLI in a fresh process (the binary embeds membot's and mcpx's CLIs, so the
 * `botholomew membot`/`botholomew mcpx` passthroughs don't need those CLIs
 * resolvable on disk). See cli-standalone.ts, commands/membot.ts, commands/mcpx.ts.
 */
export const MEMBOT_CLI_SENTINEL = "__botholomew_membot_cli__";
export const MCPX_CLI_SENTINEL = "__botholomew_mcpx_cli__";
