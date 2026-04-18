import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import {
  createContextItem,
  getContextItemByPath,
} from "../../src/db/context.ts";
import { migrate } from "../../src/db/schema.ts";
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
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

/**
 * Seed a context item with an explicit source_path so the Phase 0 dedup sees
 * it. Mirrors what a previous `context add` would have stored.
 */
async function seedFile(
  sourcePath: string,
  contextPath: string,
  content: string,
): Promise<void> {
  await writeFile(sourcePath, content);
  const conn = await getConnection(getDbPath(tempDir));
  try {
    await migrate(conn);
    await createContextItem(conn, {
      title: "seeded",
      content,
      sourceType: "file",
      sourcePath,
      contextPath,
    });
  } finally {
    conn.close();
  }
}

describe("context add source-path dedup", () => {
  test("default policy errors fast when source is already in context", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const filePath = join(tempDir, "already.md");
    await seedFile(filePath, "/user-guides/already.md", "content");

    const result = await run(["context", "add", filePath]);

    expect(result.code).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("already in context");
    expect(output).toContain(filePath);
    expect(output).toContain("/user-guides/already.md");
    // No LLM placement happened — the "Choosing paths" spinner shouldn't fire.
    expect(output).not.toContain("Choosing paths");
  });

  test("--on-conflict=skip exits cleanly and does not re-add", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const filePath = join(tempDir, "skip-me.md");
    await seedFile(filePath, "/notes/skip-me.md", "original");

    const result = await run([
      "context",
      "add",
      filePath,
      "--on-conflict=skip",
    ]);

    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("already in context");
    expect(output).toContain("1 skipped");

    // Still exactly one row with that context_path.
    const conn = await getConnection(getDbPath(tempDir));
    try {
      await migrate(conn);
      const item = await getContextItemByPath(conn, "/notes/skip-me.md");
      expect(item?.content).toBe("original");
    } finally {
      conn.close();
    }
  });

  test("--on-conflict=overwrite reuses existing context_path and refreshes", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const filePath = join(tempDir, "refresh-me.md");
    await seedFile(filePath, "/notes/refresh-me.md", "v1");

    // Simulate on-disk edit so refresh detects a content change.
    await writeFile(filePath, "v2");

    const result = await run([
      "context",
      "add",
      filePath,
      "--on-conflict=overwrite",
    ]);

    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Refreshed");

    const conn = await getConnection(getDbPath(tempDir));
    try {
      await migrate(conn);
      // Original context_path preserved, content updated.
      const item = await getContextItemByPath(conn, "/notes/refresh-me.md");
      expect(item?.content).toBe("v2");
    } finally {
      conn.close();
    }
  });
});
