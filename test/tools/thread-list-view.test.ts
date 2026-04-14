import { beforeEach, describe, expect, test } from "bun:test";
import {
  createThread,
  endThread,
  logInteraction,
} from "../../src/db/threads.ts";
import { listThreadsTool } from "../../src/tools/thread/list.ts";
import { viewThreadTool } from "../../src/tools/thread/view.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { setupToolContext } from "../helpers.ts";

let ctx: ToolContext;

beforeEach(() => {
  ({ ctx } = setupToolContext());
});

// ── list_threads ──────────────────────────────────────────

describe("list_threads", () => {
  test("returns empty list when no threads", async () => {
    const result = await listThreadsTool.execute({}, ctx);
    expect(result.threads).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("returns all threads", async () => {
    await createThread(ctx.conn, "daemon_tick", undefined, "Tick 1");
    await createThread(ctx.conn, "chat_session", undefined, "Chat 1");
    const result = await listThreadsTool.execute({}, ctx);
    expect(result.count).toBe(2);
  });

  test("filters by type", async () => {
    await createThread(ctx.conn, "daemon_tick", undefined, "Tick");
    await createThread(ctx.conn, "chat_session", undefined, "Chat");
    const result = await listThreadsTool.execute({ type: "chat_session" }, ctx);
    expect(result.count).toBe(1);
    expect(result.threads[0]?.type).toBe("chat_session");
  });

  test("respects limit", async () => {
    await createThread(ctx.conn, "daemon_tick", undefined, "A");
    await createThread(ctx.conn, "daemon_tick", undefined, "B");
    await createThread(ctx.conn, "daemon_tick", undefined, "C");
    const result = await listThreadsTool.execute({ limit: 2 }, ctx);
    expect(result.count).toBe(2);
  });
});

// ── view_thread ───────────────────────────────────────────

describe("view_thread", () => {
  test("returns thread with interactions", async () => {
    const threadId = await createThread(
      ctx.conn,
      "daemon_tick",
      undefined,
      "Test Thread",
    );
    await logInteraction(ctx.conn, threadId, {
      role: "user",
      kind: "message",
      content: "Hello",
    });
    await logInteraction(ctx.conn, threadId, {
      role: "assistant",
      kind: "message",
      content: "Hi there",
    });
    await endThread(ctx.conn, threadId);

    const result = await viewThreadTool.execute({ id: threadId }, ctx);
    expect(result.thread).not.toBeNull();
    expect(result.thread?.title).toBe("Test Thread");
    expect(result.interactions.length).toBe(2);
    expect(result.interactions[0]?.content).toBe("Hello");
    expect(result.interactions[1]?.content).toBe("Hi there");
  });

  test("returns null for missing thread", async () => {
    const result = await viewThreadTool.execute({ id: "nonexistent" }, ctx);
    expect(result.thread).toBeNull();
    expect(result.interactions).toEqual([]);
  });
});
