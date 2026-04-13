import { beforeEach, describe, expect, test } from "bun:test";
import { type DbConnection, getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import {
  createThread,
  endThread,
  getThread,
  listThreads,
  logInteraction,
} from "../../src/db/threads.ts";

let conn: DbConnection;

beforeEach(() => {
  conn = getConnection(":memory:");
  migrate(conn);
});

describe("thread CRUD", () => {
  test("create and get a thread", async () => {
    const threadId = await createThread(
      conn,
      "daemon_tick",
      undefined,
      "Test tick",
    );

    const result = await getThread(conn, threadId);
    expect(result).not.toBeNull();
    expect(result?.thread.type).toBe("daemon_tick");
    expect(result?.thread.title).toBe("Test tick");
    expect(result?.thread.ended_at).toBeNull();
    expect(result?.interactions).toHaveLength(0);
  });

  test("create thread with task_id", async () => {
    const threadId = await createThread(
      conn,
      "daemon_tick",
      "task-123",
      "Working task",
    );

    const result = await getThread(conn, threadId);
    expect(result?.thread.task_id).toBe("task-123");
  });

  test("end a thread sets ended_at", async () => {
    const threadId = await createThread(conn, "chat_session");
    await endThread(conn, threadId);

    const result = await getThread(conn, threadId);
    expect(result?.thread.ended_at).not.toBeNull();
  });

  test("get nonexistent thread returns null", async () => {
    const result = await getThread(conn, "nonexistent");
    expect(result).toBeNull();
  });
});

describe("interaction logging", () => {
  test("log and retrieve interactions in order", async () => {
    const threadId = await createThread(conn, "daemon_tick");

    await logInteraction(conn, threadId, {
      role: "user",
      kind: "message",
      content: "Work on this task",
    });

    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "thinking",
      content: "Let me think about this...",
    });

    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "tool_use",
      content: "Calling search tool",
      toolName: "search_context",
      toolInput: '{"query": "relevant docs"}',
    });

    await logInteraction(conn, threadId, {
      role: "tool",
      kind: "tool_result",
      content: "Found 3 results",
      toolName: "search_context",
      durationMs: 150,
    });

    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "message",
      content: "I found the answer.",
      tokenCount: 500,
    });

    const result = await getThread(conn, threadId);
    expect(result?.interactions).toHaveLength(5);

    // Verify ordering
    expect(result?.interactions[0]?.sequence).toBe(1);
    expect(result?.interactions[4]?.sequence).toBe(5);

    // Verify content
    expect(result?.interactions[0]?.role).toBe("user");
    expect(result?.interactions[0]?.kind).toBe("message");
    expect(result?.interactions[2]?.tool_name).toBe("search_context");
    expect(result?.interactions[2]?.tool_input).toBe(
      '{"query": "relevant docs"}',
    );
    expect(result?.interactions[3]?.duration_ms).toBe(150);
    expect(result?.interactions[4]?.token_count).toBe(500);
  });

  test("interactions with special characters in content", async () => {
    const threadId = await createThread(conn, "chat_session");

    await logInteraction(conn, threadId, {
      role: "user",
      kind: "message",
      content: "What's the user's name? It's O'Brien.",
    });

    const result = await getThread(conn, threadId);
    expect(result?.interactions[0]?.content).toBe(
      "What's the user's name? It's O'Brien.",
    );
  });
});

describe("listThreads", () => {
  test("list threads with type filter", async () => {
    await createThread(conn, "daemon_tick", undefined, "Tick 1");
    await createThread(conn, "chat_session", undefined, "Chat 1");
    await createThread(conn, "daemon_tick", undefined, "Tick 2");

    const daemonThreads = await listThreads(conn, { type: "daemon_tick" });
    expect(daemonThreads).toHaveLength(2);

    const chatThreads = await listThreads(conn, { type: "chat_session" });
    expect(chatThreads).toHaveLength(1);
  });

  test("list threads with limit", async () => {
    await createThread(conn, "daemon_tick", undefined, "Tick 1");
    await createThread(conn, "daemon_tick", undefined, "Tick 2");
    await createThread(conn, "daemon_tick", undefined, "Tick 3");

    const threads = await listThreads(conn, { limit: 2 });
    expect(threads).toHaveLength(2);
  });
});
