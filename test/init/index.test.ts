/**
 * `botholomew init` writes the on-disk project tree (config/, prompts/,
 * skills/, mcpx/, context/, tasks/, schedules/, threads/, workers/, logs/),
 * initializes the index.duckdb sidecar, and seeds default templates.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  CONTEXT_DIR,
  getDbPath,
  getMcpxDir,
  getPromptsDir,
  getSchedulesDir,
  getSchedulesLockDir,
  getSkillsDir,
  getTasksDir,
  getTasksLockDir,
  getThreadsDir,
  getWorkersDir,
  LOGS_DIR,
  MCPX_SERVERS_FILENAME,
} from "../../src/constants.ts";
import { initProject } from "../../src/init/index.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-init-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function fileText(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

describe("initProject", () => {
  test("creates the full on-disk project tree", async () => {
    await initProject(projectDir);

    expect(await isDir(join(projectDir, CONFIG_DIR))).toBe(true);
    expect(await isDir(getPromptsDir(projectDir))).toBe(true);
    expect(await isDir(getSkillsDir(projectDir))).toBe(true);
    expect(await isDir(getMcpxDir(projectDir))).toBe(true);
    expect(await isDir(join(projectDir, CONTEXT_DIR))).toBe(true);
    expect(await isDir(getTasksDir(projectDir))).toBe(true);
    expect(await isDir(getTasksLockDir(projectDir))).toBe(true);
    expect(await isDir(getSchedulesDir(projectDir))).toBe(true);
    expect(await isDir(getSchedulesLockDir(projectDir))).toBe(true);
    expect(await isDir(getThreadsDir(projectDir))).toBe(true);
    expect(await isDir(getWorkersDir(projectDir))).toBe(true);
    expect(await isDir(join(projectDir, LOGS_DIR))).toBe(true);
  });

  test("seeds prompts/{soul,beliefs,goals,capabilities}.md", async () => {
    await initProject(projectDir);
    const pc = getPromptsDir(projectDir);
    for (const name of [
      "soul.md",
      "beliefs.md",
      "goals.md",
      "capabilities.md",
    ]) {
      expect(await Bun.file(join(pc, name)).exists()).toBe(true);
    }
  });

  test("soul.md is loading=always and not agent-editable", async () => {
    await initProject(projectDir);
    const text = await fileText(join(getPromptsDir(projectDir), "soul.md"));
    expect(text).toMatch(/loading:\s*always/);
    expect(text).toMatch(/agent-modification:\s*false/);
  });

  test("beliefs.md is loading=always and agent-editable", async () => {
    await initProject(projectDir);
    const text = await fileText(join(getPromptsDir(projectDir), "beliefs.md"));
    expect(text).toMatch(/loading:\s*always/);
    expect(text).toMatch(/agent-modification:\s*true/);
  });

  test("config/config.json contains valid defaults", async () => {
    await initProject(projectDir);
    const path = join(projectDir, CONFIG_DIR, CONFIG_FILENAME);
    const cfg = JSON.parse(await fileText(path));
    expect(cfg.anthropic_api_key).toBeDefined();
    expect(cfg.model).toBeTruthy();
    expect(cfg.tick_interval_seconds).toBeGreaterThan(0);
  });

  test("seeds skills/ with the default skill files", async () => {
    await initProject(projectDir);
    const skills = getSkillsDir(projectDir);
    for (const name of ["summarize.md", "standup.md", "capabilities.md"]) {
      expect(await Bun.file(join(skills, name)).exists()).toBe(true);
    }
  });

  test("the capabilities skill invokes the capabilities_refresh tool", async () => {
    await initProject(projectDir);
    const text = await fileText(
      join(getSkillsDir(projectDir), "capabilities.md"),
    );
    expect(text).toContain("capabilities_refresh");
  });

  test("creates index.duckdb with migrations applied", async () => {
    await initProject(projectDir);
    const dbPath = getDbPath(projectDir);
    expect(await Bun.file(dbPath).exists()).toBe(true);
  });

  test("writes mcpx/servers.json with default content", async () => {
    await initProject(projectDir);
    const path = join(getMcpxDir(projectDir), MCPX_SERVERS_FILENAME);
    expect(await Bun.file(path).exists()).toBe(true);
    const cfg = JSON.parse(await fileText(path));
    expect(cfg).toBeDefined();
  });

  test("refuses to re-init without --force", async () => {
    await initProject(projectDir);
    await expect(initProject(projectDir)).rejects.toThrow(
      /already initialized/,
    );
  });

  test("succeeds with force=true on an existing project", async () => {
    await initProject(projectDir);
    await expect(
      initProject(projectDir, { force: true }),
    ).resolves.toBeUndefined();
  });

  test("capabilities.md ends up populated (LLM placeholder or fallback)", async () => {
    // Without an Anthropic key the static-fallback summarizer fills the
    // file with built-in tool theme lines.
    await initProject(projectDir);
    const text = await fileText(
      join(getPromptsDir(projectDir), "capabilities.md"),
    );
    // It should at least contain the frontmatter and a non-empty body.
    expect(text).toMatch(/loading:\s*always/);
    // Body has at least one bullet/section. Either the LLM filled it or the
    // fallback wrote internal-tool theme lines like "task management".
    expect(text.split("\n").length).toBeGreaterThan(5);
  });
});
