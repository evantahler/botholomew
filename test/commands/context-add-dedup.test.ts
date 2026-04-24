import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import { createContextItem, getContextItem } from "../../src/db/context.ts";
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
    env: { ...process.env, NO_COLOR: "1", BOTHOLOMEW_LOG_LEVEL: "info" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

/** Seed a disk-drive item at the same absolute path a real `context add` would use. */
async function seedFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  const conn = await getConnection(getDbPath(tempDir));
  try {
    await migrate(conn);
    await createContextItem(conn, {
      title: "seeded",
      content,
      drive: "disk",
      path: filePath,
    });
  } finally {
    conn.close();
  }
}

describe("context add (drive, path) dedup", () => {
  test("default policy errors fast when (disk, path) is already in context", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const filePath = join(tempDir, "already.md");
    await seedFile(filePath, "content");

    const result = await run(["context", "add", filePath]);

    expect(result.code).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("already in context");
    expect(output).toContain(`disk:${filePath}`);
  });

  test("--on-conflict=skip exits cleanly and does not re-add", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const filePath = join(tempDir, "skip-me.md");
    await seedFile(filePath, "original");

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

    const conn = await getConnection(getDbPath(tempDir));
    try {
      await migrate(conn);
      const item = await getContextItem(conn, {
        drive: "disk",
        path: filePath,
      });
      expect(item?.content).toBe("original");
    } finally {
      conn.close();
    }
  });

  test("--on-conflict=overwrite reuses existing (drive, path) and refreshes", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const filePath = join(tempDir, "refresh-me.md");
    await seedFile(filePath, "v1");
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
      const item = await getContextItem(conn, {
        drive: "disk",
        path: filePath,
      });
      expect(item?.content).toBe("v2");
    } finally {
      conn.close();
    }
  });
});
