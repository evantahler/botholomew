import { afterEach, describe, expect, test } from "bun:test";
import {
  listRegisteredProjects,
  readRegistry,
  registerProject,
  unregisterProject,
} from "../../src/utils/project-registry.ts";

describe("project-registry", () => {
  const testDir = `/tmp/botholomew-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  afterEach(async () => {
    // Clean up our test entry
    await unregisterProject(testDir);
  });

  test("readRegistry returns empty object when no file exists", async () => {
    const registry = await readRegistry();
    expect(typeof registry).toBe("object");
  });

  test("registerProject adds entry and listRegisteredProjects returns it", async () => {
    await registerProject(testDir);
    const projects = await listRegisteredProjects();
    const found = projects.find((p) => p.projectDir === testDir);
    expect(found).toBeDefined();
    expect(found?.installedAt).toBeTruthy();
  });

  test("unregisterProject removes entry", async () => {
    await registerProject(testDir);
    await unregisterProject(testDir);
    const projects = await listRegisteredProjects();
    const found = projects.find((p) => p.projectDir === testDir);
    expect(found).toBeUndefined();
  });

  test("unregisterProject is a no-op for non-existent entry", async () => {
    // Should not throw
    await unregisterProject("/nonexistent/path/that/does/not/exist");
  });

  test("registerProject overwrites existing entry", async () => {
    await registerProject(testDir);
    const before = await listRegisteredProjects();
    const first = before.find((p) => p.projectDir === testDir);

    // Small delay to get a different timestamp
    await Bun.sleep(10);
    await registerProject(testDir);
    const after = await listRegisteredProjects();
    const second = after.find((p) => p.projectDir === testDir);

    expect(second).toBeDefined();
    expect(second?.installedAt).not.toBe(first?.installedAt);
  });
});
