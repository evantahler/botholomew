import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pkg } from "../../src/pkg.ts";

const require = createRequire(import.meta.url);
const membotVersion = require("membot/package.json").version as string;

const TMP_DIR = join(import.meta.dir, ".tmp-membot-cmd-test");
const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

// Force project-local membot for these tests — the default is "global", which
// would point the passthrough at ~/.membot and pollute / leak real user state.
beforeEach(async () => {
  mkdirSync(join(TMP_DIR, "config"), { recursive: true });
  await Bun.write(
    join(TMP_DIR, "config", "config.json"),
    JSON.stringify({ mcpx_scope: "project", membot_scope: "project" }),
  );
});

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true });
  }
});

async function runBotholomewCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", CLI_PATH, "-d", TMP_DIR, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("membot CLI passthrough (end-to-end)", () => {
  // Regression for the "passthrough only forwards membot Operations" bug: the
  // wrapper enumerated one subcommand per membot Operation, so membot's
  // management commands (config, reindex, router, …) fell through to the parent
  // and errored with a misleading "too many arguments for 'membot'". They must
  // now forward to upstream membot like any other subcommand.
  test("forwards a management subcommand that is not an Operation (reindex)", async () => {
    const result = await runBotholomewCli(["membot", "reindex"]);
    expect(result.exitCode).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain("too many arguments");
    expect(combined).not.toContain("unknown command");
  });

  test("forwards `config get` (multi-token management subcommand)", async () => {
    const result = await runBotholomewCli([
      "membot",
      "config",
      "get",
      "search.max_per_file",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("too many arguments");
  });

  // Regression for the "--version is swallowed by the root version option" bug.
  // After enabling positional options + pass-through, `--version` reaches
  // upstream membot (which prints its own version) instead of botholomew's root
  // `--version` printing botholomew's package version.
  test("forwards --version to upstream membot, not botholomew's root", async () => {
    const result = await runBotholomewCli(["membot", "--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(membotVersion);
    expect(result.stdout.trim()).not.toBe(pkg.version);
  });

  // The botholomew-specific helper must stay a real Commander subcommand so it
  // is matched before the pass-through action (and shows up in --help).
  test("import-global remains a real subcommand", async () => {
    const result = await runBotholomewCli([
      "membot",
      "import-global",
      "--help",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Copy system-wide membot data");
  });
});
