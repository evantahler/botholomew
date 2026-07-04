import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

let projectDir: string;

async function runNotify(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(
    ["bun", CLI_PATH, "-d", projectDir, "notify", ...args],
    {
      // NODE_ENV=test suppresses the real OS notification the desktop channel
      // would otherwise spawn (it still reports as delivered);
      // BOTHOLOMEW_LOG_LEVEL=info un-mutes the success line (test mode defaults
      // the logger to error-only).
      env: { ...process.env, NODE_ENV: "test", BOTHOLOMEW_LOG_LEVEL: "info" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "botholomew-notify-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("botholomew notify", () => {
  test("delivers via the default desktop channel", async () => {
    const { stdout, exitCode } = await runNotify(["hello there"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Delivered via desktop");
  });

  test("errors when the requested channel type isn't configured", async () => {
    const { stderr, exitCode } = await runNotify(["hi", "--channel", "mcpx"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('No "mcpx" channels configured');
  });

  test("rejects an invalid severity", async () => {
    const { stderr, exitCode } = await runNotify(["hi", "-s", "loud"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Invalid severity");
  });
});
