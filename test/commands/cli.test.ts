import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pkg } from "../../src/pkg.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

async function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  // A throwaway `-d` keeps the CLI from touching the real project dir; the
  // dispatch errors we assert on happen before any of these commands read it.
  const proc = Bun.spawn(["bun", CLI_PATH, "-d", import.meta.dir, ...args], {
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

describe("CLI command dispatch", () => {
  test("an unknown top-level command errors with 'unknown command'", async () => {
    const { stderr, exitCode } = await runCli(["foo"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("unknown command 'foo'");
    // The old, confusing message must not resurface.
    expect(stderr).not.toContain("too many arguments");
  });

  test("a near-miss typo gets a did-you-mean suggestion", async () => {
    const { stderr, exitCode } = await runCli(["chta"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("unknown command 'chta'");
    expect(stderr).toContain("Did you mean chat?");
  });

  test("an unknown subcommand of a group errors with 'unknown command'", async () => {
    const { stderr, exitCode } = await runCli(["task", "foo"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("unknown command 'foo'");
    expect(stderr).not.toContain("too many arguments");
  });

  test("bare invocation prints help to stdout and exits 0", async () => {
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    // The command list should be present.
    expect(stdout).toContain("chat");
  });

  test("--version prints the version and exits 0 (guard doesn't swallow it)", async () => {
    const { stdout, exitCode } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(pkg.version);
  });
});
