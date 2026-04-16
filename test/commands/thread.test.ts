import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import {
  createThread,
  getThread,
  logInteraction,
} from "../../src/db/threads.ts";
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

describe("thread list", () => {
  test("shows empty message when no threads", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const result = await run(["thread", "list"]);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toContain("No threads found");
  });

  test("lists seeded threads", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    const id1 = await createThread(conn, "chat_session", undefined, "Chat A");
    const id2 = await createThread(conn, "daemon_tick", undefined, "Tick B");
    conn.close();

    const result = await run(["thread", "list"]);
    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain(id1.slice(0, 8));
    expect(output).toContain(id2.slice(0, 8));
    expect(output).toContain("Chat A");
    expect(output).toContain("Tick B");
  });

  test("filters by type", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    await createThread(conn, "chat_session", undefined, "Chat");
    await createThread(conn, "daemon_tick", undefined, "Tick");
    conn.close();

    const result = await run(["thread", "list", "-t", "chat_session"]);
    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Chat");
    expect(output).not.toContain("Tick");
  });
});

describe("thread view", () => {
  test("shows thread details and interactions", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    const threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "Test Chat",
    );
    await logInteraction(conn, threadId, {
      role: "user",
      kind: "message",
      content: "Hello there",
    });
    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "message",
      content: "Hi! How can I help?",
    });
    conn.close();

    const result = await run(["thread", "view", threadId]);
    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Test Chat");
    expect(output).toContain(threadId);
    expect(output).toContain("chat_session");
    expect(output).toContain("Interactions (2)");
    expect(output).toContain("Hello there");
    expect(output).toContain("Hi! How can I help?");
  });

  test("filters interactions by --only role", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    const threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "Filter Test",
    );
    await logInteraction(conn, threadId, {
      role: "user",
      kind: "message",
      content: "user message here",
    });
    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "message",
      content: "assistant reply here",
    });
    await logInteraction(conn, threadId, {
      role: "tool",
      kind: "tool_result",
      content: "tool output here",
    });
    conn.close();

    const result = await run([
      "thread",
      "view",
      threadId,
      "--only",
      "assistant",
    ]);
    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("assistant reply here");
    expect(output).not.toContain("user message here");
    expect(output).not.toContain("tool output here");
    expect(output).toContain("Interactions (1)");
  });

  test("filters by multiple roles with --only", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    const threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "Multi Filter",
    );
    await logInteraction(conn, threadId, {
      role: "user",
      kind: "message",
      content: "user msg",
    });
    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "message",
      content: "assistant msg",
    });
    await logInteraction(conn, threadId, {
      role: "tool",
      kind: "tool_result",
      content: "tool msg",
    });
    conn.close();

    const result = await run([
      "thread",
      "view",
      threadId,
      "--only",
      "user,tool",
    ]);
    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("user msg");
    expect(output).toContain("tool msg");
    expect(output).not.toContain("assistant msg");
    expect(output).toContain("Interactions (2)");
  });

  test("supports full ID lookup", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    const threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "Full ID Test",
    );
    conn.close();

    const result = await run(["thread", "view", threadId]);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toContain("Full ID Test");
  });

  test("errors on unknown thread", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const result = await run(["thread", "view", "nonexistent"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("Thread not found");
  });
});

describe("thread delete", () => {
  test("deletes existing thread", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    const threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "To Delete",
    );
    await logInteraction(conn, threadId, {
      role: "user",
      kind: "message",
      content: "bye",
    });
    conn.close();

    const result = await run(["thread", "delete", threadId]);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toContain("Deleted thread");

    // Verify it's actually gone
    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const gone = await getThread(conn2, threadId);
    conn2.close();
    expect(gone).toBeNull();
  });

  test("errors on unknown thread", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const result = await run(["thread", "delete", "nonexistent"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("Thread not found");
  });
});
