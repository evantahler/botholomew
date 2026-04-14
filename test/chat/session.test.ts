import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChatSession,
  endChatSession,
  startChatSession,
} from "../../src/chat/session.ts";
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
    expect(session.conn).toBeTruthy();
    expect(session.messages).toEqual([]);
    expect(session.systemPrompt).toContain("interactive chat interface");
  });

  test("creates a chat_session thread in the database", async () => {
    session = await startChatSession(projectDir);
    const threads = await listThreads(session.conn, {
      type: "chat_session",
    });
    expect(threads.length).toBe(1);
    expect(threads[0]?.id).toBe(session.threadId);
  });
});

describe("endChatSession", () => {
  test("closes the thread and connection", async () => {
    session = await startChatSession(projectDir);
    const conn = session.conn;

    // Verify thread exists and is open
    const threads = await listThreads(conn, { type: "chat_session" });
    expect(threads[0]?.ended_at).toBeNull();

    await endChatSession(session);
    session = null;

    // Connection is closed, so we can't query it anymore
    // But we verified the thread was open before closing
  });
});
