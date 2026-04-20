import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  createThread,
  deleteThread,
  endThread,
  getActiveThread,
  getInteractionsAfter,
  getThread,
  isThreadEnded,
  listThreads,
  logInteraction,
  updateThreadTitle,
} from "../../src/db/threads.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

describe("thread CRUD", () => {
  test("create and get a thread", async () => {
    const threadId = await createThread(
      conn,
      "worker_tick",
      undefined,
      "Test tick",
    );

    const result = await getThread(conn, threadId);
    expect(result).not.toBeNull();
    expect(result?.thread.type).toBe("worker_tick");
    expect(result?.thread.title).toBe("Test tick");
    expect(result?.thread.ended_at).toBeNull();
    expect(result?.interactions).toHaveLength(0);
  });

  test("create thread with task_id", async () => {
    const threadId = await createThread(
      conn,
      "worker_tick",
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

  test("update thread title", async () => {
    const threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "Interactive chat",
    );

    await updateThreadTitle(conn, threadId, "Discussing project architecture");

    const result = await getThread(conn, threadId);
    expect(result?.thread.title).toBe("Discussing project architecture");
  });

  test("get nonexistent thread returns null", async () => {
    const result = await getThread(conn, "nonexistent");
    expect(result).toBeNull();
  });
});

describe("interaction logging", () => {
  test("log and retrieve interactions in order", async () => {
    const threadId = await createThread(conn, "worker_tick");

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
      toolName: "context_search",
      toolInput: '{"query": "relevant docs"}',
    });

    await logInteraction(conn, threadId, {
      role: "tool",
      kind: "tool_result",
      content: "Found 3 results",
      toolName: "context_search",
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
    expect(result?.interactions[2]?.tool_name).toBe("context_search");
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

describe("deleteThread", () => {
  test("deletes thread and its interactions", async () => {
    const threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "To delete",
    );
    await logInteraction(conn, threadId, {
      role: "user",
      kind: "message",
      content: "Hello",
    });
    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "message",
      content: "Hi there",
    });

    const deleted = await deleteThread(conn, threadId);
    expect(deleted).toBe(true);

    const result = await getThread(conn, threadId);
    expect(result).toBeNull();
  });

  test("returns false for nonexistent thread", async () => {
    const deleted = await deleteThread(conn, "nonexistent-id");
    expect(deleted).toBe(false);
  });

  test("deletes thread with no interactions", async () => {
    const threadId = await createThread(
      conn,
      "worker_tick",
      undefined,
      "Empty",
    );
    const deleted = await deleteThread(conn, threadId);
    expect(deleted).toBe(true);

    const result = await getThread(conn, threadId);
    expect(result).toBeNull();
  });
});

describe("listThreads", () => {
  test("list threads with type filter", async () => {
    await createThread(conn, "worker_tick", undefined, "Tick 1");
    await createThread(conn, "chat_session", undefined, "Chat 1");
    await createThread(conn, "worker_tick", undefined, "Tick 2");

    const daemonThreads = await listThreads(conn, { type: "worker_tick" });
    expect(daemonThreads).toHaveLength(2);

    const chatThreads = await listThreads(conn, { type: "chat_session" });
    expect(chatThreads).toHaveLength(1);
  });

  test("list threads with limit", async () => {
    await createThread(conn, "worker_tick", undefined, "Tick 1");
    await createThread(conn, "worker_tick", undefined, "Tick 2");
    await createThread(conn, "worker_tick", undefined, "Tick 3");

    const threads = await listThreads(conn, { limit: 2 });
    expect(threads).toHaveLength(2);
  });

  test("list threads with limit and offset", async () => {
    await createThread(conn, "worker_tick", undefined, "Tick 1");
    await createThread(conn, "worker_tick", undefined, "Tick 2");
    await createThread(conn, "worker_tick", undefined, "Tick 3");
    await createThread(conn, "worker_tick", undefined, "Tick 4");

    const page = await listThreads(conn, { limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
    expect(page[0]?.title).toBe("Tick 3");
    expect(page[1]?.title).toBe("Tick 2");
  });
});

describe("follow queries", () => {
  test("getInteractionsAfter returns only interactions after given sequence", async () => {
    const threadId = await createThread(conn, "worker_tick");
    for (let i = 0; i < 5; i++) {
      await logInteraction(conn, threadId, {
        role: "assistant",
        kind: "message",
        content: `Message ${i + 1}`,
      });
    }

    const after3 = await getInteractionsAfter(conn, threadId, 3);
    expect(after3).toHaveLength(2);
    expect(after3[0]?.sequence).toBe(4);
    expect(after3[1]?.sequence).toBe(5);
  });

  test("getInteractionsAfter returns empty when caught up", async () => {
    const threadId = await createThread(conn, "worker_tick");
    await logInteraction(conn, threadId, {
      role: "assistant",
      kind: "message",
      content: "Only message",
    });

    const result = await getInteractionsAfter(conn, threadId, 1);
    expect(result).toHaveLength(0);
  });

  test("getActiveThread returns most recent active thread", async () => {
    const id1 = await createThread(
      conn,
      "worker_tick",
      undefined,
      "First tick",
    );
    await endThread(conn, id1);
    const id2 = await createThread(
      conn,
      "worker_tick",
      undefined,
      "Second tick",
    );

    const active = await getActiveThread(conn);
    expect(active).not.toBeNull();
    expect(active?.id).toBe(id2);
    expect(active?.title).toBe("Second tick");
  });

  test("getActiveThread returns null when all threads ended", async () => {
    const id = await createThread(conn, "worker_tick");
    await endThread(conn, id);

    const active = await getActiveThread(conn);
    expect(active).toBeNull();
  });

  test("isThreadEnded returns false for active thread", async () => {
    const id = await createThread(conn, "worker_tick");
    expect(await isThreadEnded(conn, id)).toBe(false);
  });

  test("isThreadEnded returns true for ended thread", async () => {
    const id = await createThread(conn, "worker_tick");
    await endThread(conn, id);
    expect(await isThreadEnded(conn, id)).toBe(true);
  });

  test("isThreadEnded returns true for nonexistent thread", async () => {
    expect(await isThreadEnded(conn, "nonexistent")).toBe(true);
  });
});
