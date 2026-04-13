import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { initProject } from "../../src/init/index.ts";
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
    expect(await Bun.file(join(dotDir, "config.json")).exists()).toBe(true);
    expect(await Bun.file(join(dotDir, "mcpx", "servers.json")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(dotDir, "data.duckdb")).exists()).toBe(true);
  });

  test("soul.md has correct frontmatter", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const raw = await Bun.file(join(tempDir, ".botholomew", "soul.md")).text();
    const { meta } = parseContextFile(raw);

    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(false);
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

  test("config.json has defaults without API key", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const config = JSON.parse(
      await Bun.file(join(tempDir, ".botholomew", "config.json")).text(),
    );
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.tick_interval_seconds).toBe(300);
    expect(config.anthropic_api_key).toBeUndefined();
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

  test("creates .gitignore entries", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const gitignore = await Bun.file(join(tempDir, ".gitignore")).text();
    expect(gitignore).toContain(".botholomew/");
  });
});
