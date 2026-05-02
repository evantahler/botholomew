import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { initProject } from "../../src/init/index.ts";
import { parseSkillFile } from "../../src/skills/parser.ts";
import { parseContextFile } from "../../src/utils/frontmatter.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("initProject", () => {
  test("creates .botholomew directory with all files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const dotDir = join(tempDir, ".botholomew");

    // Check all expected files exist
    expect(await Bun.file(join(dotDir, "soul.md")).exists()).toBe(true);
    expect(await Bun.file(join(dotDir, "beliefs.md")).exists()).toBe(true);
    expect(await Bun.file(join(dotDir, "goals.md")).exists()).toBe(true);
    expect(await Bun.file(join(dotDir, "capabilities.md")).exists()).toBe(true);
    expect(await Bun.file(join(dotDir, "config.json")).exists()).toBe(true);
    expect(await Bun.file(join(dotDir, "mcpx", "servers.json")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(dotDir, "data.duckdb")).exists()).toBe(true);
  });

  test("capabilities.md is populated with the high-level capability summary", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const raw = await Bun.file(
      join(tempDir, ".botholomew", "capabilities.md"),
    ).text();
    const { meta, content } = parseContextFile(raw);

    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(true);
    expect(content).toContain("# Capabilities");
    expect(content).toContain("## Internal capabilities");
    expect(content).toContain("Task management");
    expect(content).toContain("Virtual filesystem");
    // seeded servers.json has no servers, so MCPX section announces that
    expect(content).toContain("No MCPX servers configured");
  });

  test("soul.md has correct frontmatter", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const raw = await Bun.file(join(tempDir, ".botholomew", "soul.md")).text();
    const { meta } = parseContextFile(raw);

    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(false);
  });

  test("soul.md instructs the agent to be direct and skip flattery", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const raw = await Bun.file(join(tempDir, ".botholomew", "soul.md")).text();
    const { content } = parseContextFile(raw);

    expect(content).toContain("lead with the answer");
    expect(content).toContain("never flatter");
  });

  test("beliefs.md is agent-editable", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const raw = await Bun.file(
      join(tempDir, ".botholomew", "beliefs.md"),
    ).text();
    const { meta } = parseContextFile(raw);

    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(true);
  });

  test("config.json has defaults with placeholder API key", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const config = JSON.parse(
      await Bun.file(join(tempDir, ".botholomew", "config.json")).text(),
    );
    expect(config.model).toBe("claude-opus-4-6");
    expect(config.tick_interval_seconds).toBe(300);
    expect(config.anthropic_api_key).toBe("your-api-key-here");
    // Every schema key is present so users can discover and tune all options
    // without grepping the source.
    expect(Object.keys(config).sort()).toEqual(
      Object.keys(DEFAULT_CONFIG).sort(),
    );
  });

  test("throws if already initialized without --force", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    expect(initProject(tempDir)).rejects.toThrow("already initialized");
  });

  test("succeeds with --force on existing project", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);
    await initProject(tempDir, { force: true }); // should not throw
  });

  test("creates skills directory with default skill files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const skillsDir = join(tempDir, ".botholomew", "skills");
    const expectedSkills = ["summarize.md", "standup.md", "capabilities.md"];

    for (const filename of expectedSkills) {
      const file = Bun.file(join(skillsDir, filename));
      expect(await file.exists()).toBe(true);

      const raw = await file.text();
      const skill = parseSkillFile(raw, filename);
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.body).toBeTruthy();
    }
  });

  test("capabilities skill invokes capabilities_refresh", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const raw = await Bun.file(
      join(tempDir, ".botholomew", "skills", "capabilities.md"),
    ).text();
    const skill = parseSkillFile(raw, "capabilities.md");
    expect(skill.name).toBe("capabilities");
    expect(skill.body).toContain("capabilities_refresh");
  });

  test("creates .gitignore entries", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const gitignore = await Bun.file(join(tempDir, ".gitignore")).text();
    expect(gitignore).toContain(".botholomew/");
  });
});
