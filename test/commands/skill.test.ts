import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOTHOLOMEW_DIR, SKILLS_DIR } from "../../src/constants.ts";
import { initProject } from "../../src/init/index.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

async function run(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", CLI, "--dir", tempDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", BOTHOLOMEW_LOG_LEVEL: "info" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("skill list CLI", () => {
  test("lists all seeded skills", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const result = await run(["skill", "list"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("summarize");
    expect(result.stdout).toContain("standup");
    expect(result.stdout).toMatch(/skill\(s\)/);
  });

  test("reports empty state when no skills are present", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    // Deliberately do not call initProject — loadSkills handles the
    // missing directory gracefully.

    const result = await run(["skill", "list"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No skill files found.");
  });
});

describe("skill show CLI", () => {
  test("prints raw file contents including frontmatter", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    const skillsDir = join(tempDir, BOTHOLOMEW_DIR, SKILLS_DIR);
    await mkdir(skillsDir, { recursive: true });
    const raw = `---
name: greet
description: "Say hello"
arguments: []
---

Hello, world!
`;
    await Bun.write(join(skillsDir, "greet.md"), raw);

    const result = await run(["skill", "show", "greet"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(raw);
  });

  test("exits non-zero and lists available skills on miss", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const result = await run(["skill", "show", "does-not-exist"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Skill not found: does-not-exist");
    expect(result.stderr).toContain("Available:");
    expect(result.stderr).toContain("summarize");
  });

  test("exits non-zero without an available list when no skills exist", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    const skillsDir = join(tempDir, BOTHOLOMEW_DIR, SKILLS_DIR);
    await mkdir(skillsDir, { recursive: true });

    const result = await run(["skill", "show", "anything"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Skill not found: anything");
    expect(result.stderr).not.toContain("Available:");
  });
});
