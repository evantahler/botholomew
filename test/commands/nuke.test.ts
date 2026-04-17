import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/constants.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import { getConnection } from "../../src/db/connection.ts";
import { createContextItem } from "../../src/db/context.ts";
import { createSchedule } from "../../src/db/schedules.ts";
import { migrate } from "../../src/db/schema.ts";
import { createTask } from "../../src/db/tasks.ts";
import { createThread, logInteraction } from "../../src/db/threads.ts";
import { initProject } from "../../src/init/index.ts";
import { writePidFile } from "../../src/utils/pid.ts";

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

async function seedAll(conn: DbConnection): Promise<void> {
  await createContextItem(conn, {
    title: "doc.md",
    content: "hello",
    contextPath: "/docs/doc.md",
  });
  await createTask(conn, { name: "example task" });
  await createSchedule(conn, { name: "nightly", frequency: "0 0 * * *" });
  const threadId = await createThread(conn, "chat_session", undefined, "t1");
  await logInteraction(conn, threadId, {
    role: "user",
    kind: "message",
    content: "hi",
  });
}

async function count(conn: DbConnection, table: string): Promise<number> {
  const row = await conn.queryGet<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ${table}`,
  );
  return row ? Number(row.cnt) : 0;
}

async function seededCounts(conn: DbConnection) {
  return {
    context_items: await count(conn, "context_items"),
    tasks: await count(conn, "tasks"),
    schedules: await count(conn, "schedules"),
    threads: await count(conn, "threads"),
    interactions: await count(conn, "interactions"),
  };
}

async function setupSeeded(): Promise<DbConnection> {
  tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
  await initProject(tempDir);
  const conn = await getConnection(getDbPath(tempDir));
  await migrate(conn);
  await seedAll(conn);
  return conn;
}

describe("nuke CLI", () => {
  test("nuke context --yes clears context and embeddings only", async () => {
    const conn = await setupSeeded();
    conn.close();

    const result = await run(["nuke", "context", "--yes"]);
    expect(result.code).toBe(0);

    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const after = await seededCounts(conn2);
    conn2.close();

    expect(after.context_items).toBe(0);
    expect(after.tasks).toBe(1);
    expect(after.schedules).toBe(1);
    expect(after.threads).toBe(1);
    expect(after.interactions).toBe(1);
  });

  test("nuke tasks --yes clears tasks only", async () => {
    const conn = await setupSeeded();
    conn.close();

    const result = await run(["nuke", "tasks", "--yes"]);
    expect(result.code).toBe(0);

    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const after = await seededCounts(conn2);
    conn2.close();

    expect(after.tasks).toBe(0);
    expect(after.context_items).toBe(1);
    expect(after.schedules).toBe(1);
    expect(after.threads).toBe(1);
  });

  test("nuke schedules --yes clears schedules only", async () => {
    const conn = await setupSeeded();
    conn.close();

    const result = await run(["nuke", "schedules", "--yes"]);
    expect(result.code).toBe(0);

    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const after = await seededCounts(conn2);
    conn2.close();

    expect(after.schedules).toBe(0);
    expect(after.tasks).toBe(1);
    expect(after.context_items).toBe(1);
    expect(after.threads).toBe(1);
  });

  test("nuke threads --yes clears threads and interactions only", async () => {
    const conn = await setupSeeded();
    conn.close();

    const result = await run(["nuke", "threads", "--yes"]);
    expect(result.code).toBe(0);

    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const after = await seededCounts(conn2);
    conn2.close();

    expect(after.threads).toBe(0);
    expect(after.interactions).toBe(0);
    expect(after.tasks).toBe(1);
    expect(after.context_items).toBe(1);
    expect(after.schedules).toBe(1);
  });

  test("nuke all --yes clears everything but preserves _migrations", async () => {
    const conn = await setupSeeded();
    conn.close();

    const result = await run(["nuke", "all", "--yes"]);
    expect(result.code).toBe(0);

    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const after = await seededCounts(conn2);
    const migrations = await count(conn2, "_migrations");
    conn2.close();

    expect(after.context_items).toBe(0);
    expect(after.tasks).toBe(0);
    expect(after.schedules).toBe(0);
    expect(after.threads).toBe(0);
    expect(after.interactions).toBe(0);
    expect(migrations).toBeGreaterThan(0);
  });

  test("without --yes exits 1 and does not delete", async () => {
    const conn = await setupSeeded();
    conn.close();

    const result = await run(["nuke", "tasks"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("Would delete");
    expect(result.stdout + result.stderr).toContain("--yes");

    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const after = await seededCounts(conn2);
    conn2.close();
    expect(after.tasks).toBe(1);
  });

  test("refuses when daemon is running", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    // Point the pid file at our own process — guaranteed to be alive
    writePidFile(tempDir, process.pid);

    const result = await run(["nuke", "all", "--yes"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("Daemon is running");
  });
});
