import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChatSession,
  endChatSession,
  startChatSession,
} from "../../src/chat/session.ts";
import { withDb } from "../../src/db/connection.ts";
import { listThreads } from "../../src/db/threads.ts";

let projectDir: string;
let session: ChatSession | null = null;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-test-"));
  const bothDir = join(projectDir, ".botholomew");
  await mkdir(bothDir, { recursive: true });
  // Write a minimal config
  await writeFile(
    join(bothDir, "config.json"),
    JSON.stringify({ anthropic_api_key: "test-key" }),
  );
});

afterEach(async () => {
  if (session) {
    await endChatSession(session);
    session = null;
  }
  await rm(projectDir, { recursive: true, force: true });
});

describe("startChatSession", () => {
  test("creates a session with a thread", async () => {
    session = await startChatSession(projectDir);
    expect(session.threadId).toBeTruthy();
    expect(session.dbPath).toBeTruthy();
    expect(session.messages).toEqual([]);
  });

  test("creates a chat_session thread in the database", async () => {
    session = await startChatSession(projectDir);
    const threads = await withDb(session.dbPath, (conn) =>
      listThreads(conn, { type: "chat_session" }),
    );
    expect(threads.length).toBe(1);
    expect(threads[0]?.id).toBe(session.threadId);
  });
});

describe("endChatSession", () => {
  test("marks the thread ended", async () => {
    session = await startChatSession(projectDir);
    const dbPath = session.dbPath;

    const before = await withDb(dbPath, (conn) =>
      listThreads(conn, { type: "chat_session" }),
    );
    expect(before[0]?.ended_at).toBeNull();

    await endChatSession(session);
    session = null;

    const after = await withDb(dbPath, (conn) =>
      listThreads(conn, { type: "chat_session" }),
    );
    expect(after[0]?.ended_at).not.toBeNull();
  });
});
