import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { THREADS_DIR } from "../../src/constants.ts";
import {
  createThread,
  endThread,
  logInteraction,
} from "../../src/threads/store.ts";
import { searchThreadsTool } from "../../src/tools/thread/search.ts";
import { viewThreadTool } from "../../src/tools/thread/view.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-thread-tools-"));
  await mkdir(join(projectDir, THREADS_DIR), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    conn: null as never,
    dbPath: ":memory:",
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
}

describe("view_thread pagination", () => {
  test("returns the first page and reports has_more when total exceeds limit", async () => {
    const id = await createThread(
      projectDir,
      "chat_session",
      undefined,
      "long",
    );
    for (let i = 0; i < 12; i++) {
      await logInteraction(projectDir, id, {
        role: "user",
        kind: "message",
        content: `msg-${i}`,
      });
    }
    const page = await viewThreadTool.execute(
      { id, offset: 0, limit: 5 },
      ctx(),
    );
    expect(page.is_error).toBe(false);
    expect(page.total_interactions).toBe(12);
    expect(page.interactions).toHaveLength(5);
    expect(page.interactions[0]?.content).toBe("msg-0");
    expect(page.interactions[4]?.content).toBe("msg-4");
    expect(page.has_more).toBe(true);
    expect(page.next_action_hint).toContain("offset=5");
  });

  test("subsequent pages walk forward and the final page has_more=false", async () => {
    const id = await createThread(projectDir, "chat_session");
    for (let i = 0; i < 7; i++) {
      await logInteraction(projectDir, id, {
        role: "user",
        kind: "message",
        content: `msg-${i}`,
      });
    }
    const p1 = await viewThreadTool.execute({ id, offset: 0, limit: 3 }, ctx());
    const p2 = await viewThreadTool.execute({ id, offset: 3, limit: 3 }, ctx());
    const p3 = await viewThreadTool.execute({ id, offset: 6, limit: 3 }, ctx());
    expect(p1.interactions.map((i) => i.content)).toEqual([
      "msg-0",
      "msg-1",
      "msg-2",
    ]);
    expect(p2.interactions.map((i) => i.content)).toEqual([
      "msg-3",
      "msg-4",
      "msg-5",
    ]);
    expect(p3.interactions.map((i) => i.content)).toEqual(["msg-6"]);
    expect(p3.has_more).toBe(false);
  });

  test("returns empty page (no error) for a missing thread", async () => {
    const result = await viewThreadTool.execute(
      { id: "no-such-thread", offset: 0, limit: 50 },
      ctx(),
    );
    expect(result.is_error).toBe(false);
    expect(result.thread).toBeNull();
    expect(result.interactions).toEqual([]);
  });
});

describe("search_threads", () => {
  async function seedThreads(): Promise<{ a: string; b: string }> {
    const a = await createThread(
      projectDir,
      "chat_session",
      undefined,
      "alpha",
    );
    await logInteraction(projectDir, a, {
      role: "user",
      kind: "message",
      content: "lunch plans for tomorrow",
    });
    await logInteraction(projectDir, a, {
      role: "assistant",
      kind: "message",
      content: "Try the new ramen place near 5th and Mission.",
    });

    const b = await createThread(
      projectDir,
      "worker_tick",
      undefined,
      "beta-job",
    );
    await logInteraction(projectDir, b, {
      role: "user",
      kind: "message",
      content: "Process the kubernetes deployment manifest.",
    });
    await logInteraction(projectDir, b, {
      role: "assistant",
      kind: "tool_use",
      content: "Calling context_read",
      toolName: "context_read",
      toolInput: '{"path":"k8s/deployment.yaml"}',
    });
    await endThread(projectDir, b);
    return { a, b };
  }

  test("returns hits with thread_id + sequence pointing to the matching interaction", async () => {
    const { a } = await seedThreads();
    const result = await searchThreadsTool.execute(
      { pattern: "ramen", ignore_case: true, max_results: 20 },
      ctx(),
    );
    expect(result.is_error).toBe(false);
    expect(result.threads_scanned).toBe(2);
    expect(result.matches).toHaveLength(1);
    const hit = result.matches[0];
    if (!hit) throw new Error("missing hit");
    expect(hit.thread_id).toBe(a);
    expect(hit.thread_title).toBe("alpha");
    // Second interaction (assistant message) is sequence 2 (1-based).
    expect(hit.sequence).toBe(2);
    expect(hit.role).toBe("assistant");
    expect(hit.content_snippet.toLowerCase()).toContain("ramen");
  });

  test("filters by role + kind", async () => {
    await seedThreads();
    const onlyUser = await searchThreadsTool.execute(
      {
        pattern: "lunch|kubernetes",
        role: "user",
        ignore_case: true,
        max_results: 20,
      },
      ctx(),
    );
    expect(onlyUser.matches).toHaveLength(2);
    for (const m of onlyUser.matches) expect(m.role).toBe("user");

    const onlyToolUse = await searchThreadsTool.execute(
      {
        pattern: "context_read",
        kind: "tool_use",
        ignore_case: true,
        max_results: 20,
      },
      ctx(),
    );
    expect(onlyToolUse.matches.length).toBeGreaterThan(0);
    for (const m of onlyToolUse.matches) expect(m.kind).toBe("tool_use");
  });

  test("matches against tool_input as well as content", async () => {
    await seedThreads();
    const result = await searchThreadsTool.execute(
      { pattern: "deployment.yaml", ignore_case: true, max_results: 20 },
      ctx(),
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.kind).toBe("tool_use");
  });

  test("filters by thread_type (chat_session vs worker_tick)", async () => {
    await seedThreads();
    const chat = await searchThreadsTool.execute(
      {
        pattern: "the|a",
        thread_type: "chat_session",
        ignore_case: true,
        max_results: 50,
      },
      ctx(),
    );
    for (const m of chat.matches) expect(m.thread_type).toBe("chat_session");
    expect(chat.threads_scanned).toBe(1);
  });

  test("rejects an invalid regex with a clear error", async () => {
    await seedThreads();
    const result = await searchThreadsTool.execute(
      { pattern: "(", ignore_case: true, max_results: 5 },
      ctx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_regex");
  });

  test("hit sequence + view_thread offset round-trips back to the matching interaction", async () => {
    await seedThreads();
    const search = await searchThreadsTool.execute(
      { pattern: "ramen", ignore_case: true, max_results: 5 },
      ctx(),
    );
    const hit = search.matches[0];
    if (!hit) throw new Error("missing");
    const view = await viewThreadTool.execute(
      { id: hit.thread_id, offset: hit.sequence - 1, limit: 1 },
      ctx(),
    );
    expect(view.interactions).toHaveLength(1);
    expect(view.interactions[0]?.sequence).toBe(hit.sequence);
    expect(view.interactions[0]?.content.toLowerCase()).toContain("ramen");
  });
});
