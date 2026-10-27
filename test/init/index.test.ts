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
import { buildDefaultConfig } from "../../src/init/templates.ts";

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
    // No more `context/` directory — knowledge lives in index.duckdb (membot).
    expect(await isDir(getTasksDir(projectDir))).toBe(true);
    expect(await isDir(getTasksLockDir(projectDir))).toBe(true);
    expect(await isDir(getSchedulesDir(projectDir))).toBe(true);
    expect(await isDir(getSchedulesLockDir(projectDir))).toBe(true);
    expect(await isDir(getThreadsDir(projectDir))).toBe(true);
    expect(await isDir(getWorkersDir(projectDir))).toBe(true);
    expect(await isDir(join(projectDir, LOGS_DIR))).toBe(true);
  });

  test("seeds prompts/{goals,beliefs,capabilities}.md and no longer writes soul.md", async () => {
    await initProject(projectDir);
    const pc = getPromptsDir(projectDir);
    for (const name of ["goals.md", "beliefs.md", "capabilities.md"]) {
      expect(await Bun.file(join(pc, name)).exists()).toBe(true);
    }
    expect(await Bun.file(join(pc, "soul.md")).exists()).toBe(false);
  });

  test("goals.md absorbs the soul identity prose", async () => {
    await initProject(projectDir);
    const text = await fileText(join(getPromptsDir(projectDir), "goals.md"));
    expect(text).toMatch(/title:\s*Goals/);
    expect(text).toMatch(/loading:\s*always/);
    expect(text).toMatch(/agent-modification:\s*true/);
    // Identity prose merged from the old soul.md.
    expect(text).toContain("wise owl");
    // Existing goal bullet preserved.
    expect(text).toContain("Get set up and ready to help.");
  });

  test("beliefs.md is loading=always and agent-editable", async () => {
    await initProject(projectDir);
    const text = await fileText(join(getPromptsDir(projectDir), "beliefs.md"));
    expect(text).toMatch(/title:\s*Beliefs/);
    expect(text).toMatch(/loading:\s*always/);
    expect(text).toMatch(/agent-modification:\s*true/);
  });

  test("seeded prompts all pass strict frontmatter validation", async () => {
    const { parsePromptFile } = await import("../../src/utils/frontmatter.ts");
    await initProject(projectDir);
    const pc = getPromptsDir(projectDir);
    for (const name of ["goals.md", "beliefs.md", "capabilities.md"]) {
      const path = join(pc, name);
      const raw = await fileText(path);
      // Throws PromptValidationError if any seed file has bad frontmatter.
      parsePromptFile(path, raw);
    }
  });

  test("config/config.json contains valid defaults", async () => {
    await initProject(projectDir);
    const path = join(projectDir, CONFIG_DIR, CONFIG_FILENAME);
    const cfg = JSON.parse(await fileText(path));
    expect(cfg.models).toBeDefined();
    expect(cfg.default_model).toBe("default");
    expect(cfg.fast_model).toBe("fast");
    expect(cfg.models[cfg.default_model].provider).toBe("anthropic");
    expect(cfg.models[cfg.default_model].model).toBeTruthy();
    expect(cfg.models[cfg.fast_model].model).toBeTruthy();
    expect(cfg.tick_interval_seconds).toBeGreaterThan(0);
    // The old two-block shape is gone, not aliased.
    expect(cfg.llm).toBeUndefined();
    expect(cfg.chunker_llm).toBeUndefined();
  });

  // Asserted against `buildDefaultConfig` rather than a full `initProject`:
  // seeding an ollama config makes init's capability scan attempt a live call
  // to localhost:11434, which hangs on a machine with no ollama running.
  test("--provider ollama seeds every model entry on the ollama preset", () => {
    const cfg = buildDefaultConfig("ollama");
    const entries = Object.values(cfg.models);
    expect(entries.length).toBeGreaterThan(1);
    for (const entry of entries) {
      expect(entry.provider).toBe("ollama");
      expect(entry.base_url).toBe("http://localhost:11434");
    }
    // Role pointers must name entries that actually exist.
    expect(cfg.models[cfg.default_model]).toBeDefined();
    expect(cfg.models[cfg.fast_model]).toBeDefined();
  });

  test("each provider preset gives the fast entry a cheaper model", () => {
    for (const provider of [
      "anthropic",
      "ollama",
      "openai-compatible",
    ] as const) {
      const cfg = buildDefaultConfig(provider);
      expect(cfg.models[cfg.default_model]?.model).not.toBe(
        cfg.models[cfg.fast_model]?.model,
      );
    }
  });

  test("seeds skills/ with the default skill files", async () => {
    await initProject(projectDir);
    const skills = getSkillsDir(projectDir);
    for (const name of ["summarize.md", "standup.md", "capabilities.md"]) {
      expect(await Bun.file(join(skills, name)).exists()).toBe(true);
    }
  });

  test("does NOT seed a dream skill — /dream is a built-in command", async () => {
    await initProject(projectDir);
    expect(
      await Bun.file(join(getSkillsDir(projectDir), "dream.md")).exists(),
    ).toBe(false);
  });

  test("the capabilities skill invokes the capabilities_refresh tool", async () => {
    await initProject(projectDir);
    const text = await fileText(
      join(getSkillsDir(projectDir), "capabilities.md"),
    );
    expect(text).toContain("capabilities_refresh");
  });

  test("creates index.duckdb (membot store) with migrations applied when membot_scope=project", async () => {
    await initProject(projectDir, { membotScope: "project" });
    const dbPath = join(projectDir, "index.duckdb");
    expect(await Bun.file(dbPath).exists()).toBe(true);
  });

  test("does NOT create a project-local index.duckdb under the default (global) scope", async () => {
    await initProject(projectDir);
    const dbPath = join(projectDir, "index.duckdb");
    expect(await Bun.file(dbPath).exists()).toBe(false);
  });

  test("writes mcpx/servers.json with default content when mcpx_scope=project", async () => {
    await initProject(projectDir, { mcpxScope: "project" });
    const path = join(getMcpxDir(projectDir), MCPX_SERVERS_FILENAME);
    expect(await Bun.file(path).exists()).toBe(true);
    const cfg = JSON.parse(await fileText(path));
    expect(cfg).toBeDefined();
  });

  test("does NOT seed a project-local mcpx/servers.json under the default (global) scope", async () => {
    await initProject(projectDir);
    const path = join(getMcpxDir(projectDir), MCPX_SERVERS_FILENAME);
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("config.json records the scope choices that were applied", async () => {
    await initProject(projectDir);
    const cfg = JSON.parse(
      await fileText(join(projectDir, CONFIG_DIR, CONFIG_FILENAME)),
    );
    expect(cfg.membot_scope).toBe("global");
    expect(cfg.mcpx_scope).toBe("global");

    await rm(projectDir, { recursive: true, force: true });
    projectDir = await mkdtemp(join(tmpdir(), "both-init-"));
    await initProject(projectDir, {
      membotScope: "project",
      mcpxScope: "project",
    });
    const cfg2 = JSON.parse(
      await fileText(join(projectDir, CONFIG_DIR, CONFIG_FILENAME)),
    );
    expect(cfg2.membot_scope).toBe("project");
    expect(cfg2.mcpx_scope).toBe("project");
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
