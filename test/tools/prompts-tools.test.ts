/**
 * update_beliefs / update_goals / read_large_result / list_threads
 * tools — the parts of the tool surface not yet covered elsewhere.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getPromptsDir, getThreadsDir } from "../../src/constants.ts";
import { createThread } from "../../src/threads/store.ts";
import { readLargeResultTool } from "../../src/tools/context/read-large-result.ts";
import { updateBeliefsTool } from "../../src/tools/context/update-beliefs.ts";
import { updateGoalsTool } from "../../src/tools/context/update-goals.ts";
import { listThreadsTool } from "../../src/tools/thread/list.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import {
  clearLargeResults,
  storeLargeResult,
} from "../../src/worker/large-results.ts";

let projectDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-prompts-tools-"));
  await mkdir(getPromptsDir(projectDir), { recursive: true });
  await mkdir(getThreadsDir(projectDir), { recursive: true });
  ctx = {
    conn: null as never,
    dbPath: ":memory:",
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
  clearLargeResults();
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
  clearLargeResults();
});

describe("update_beliefs", () => {
  test("creates beliefs.md with default frontmatter when missing", async () => {
    const r = await updateBeliefsTool.execute(
      { content: "I believe in tests." },
      ctx,
    );
    expect(r.is_error).toBe(false);
    const text = await Bun.file(
      join(getPromptsDir(projectDir), "beliefs.md"),
    ).text();
    expect(text).toMatch(/loading:\s*always/);
    expect(text).toMatch(/agent-modification:\s*true/);
    expect(text).toContain("I believe in tests.");
  });

  test("preserves existing frontmatter on update", async () => {
    const path = join(getPromptsDir(projectDir), "beliefs.md");
    await writeFile(
      path,
      "---\nloading: always\nagent-modification: true\ncustom_flag: persisted\n---\n\n# old\n",
    );
    await updateBeliefsTool.execute({ content: "new beliefs" }, ctx);
    const text = await Bun.file(path).text();
    expect(text).toContain("custom_flag: persisted");
    expect(text).toContain("new beliefs");
  });

  test("refuses to overwrite when agent-modification is false", async () => {
    const path = join(getPromptsDir(projectDir), "beliefs.md");
    await writeFile(
      path,
      "---\nloading: always\nagent-modification: false\n---\n\n# locked\n",
    );
    const r = await updateBeliefsTool.execute({ content: "ignored" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.message).toContain("not allowed");
    const text = await Bun.file(path).text();
    expect(text).toContain("# locked");
    expect(text).not.toContain("ignored");
  });
});

describe("update_goals", () => {
  test("creates goals.md when missing", async () => {
    const r = await updateGoalsTool.execute(
      { content: "Ship the docs sweep." },
      ctx,
    );
    expect(r.is_error).toBe(false);
    const text = await Bun.file(
      join(getPromptsDir(projectDir), "goals.md"),
    ).text();
    expect(text).toContain("Ship the docs sweep.");
  });
});

describe("read_large_result", () => {
  test("paginates a stored large result", async () => {
    const id = storeLargeResult("fake_tool", "x".repeat(20_000));
    const page1 = await readLargeResultTool.execute({ id, page: 1 });
    expect(page1.is_error).toBe(false);
    expect(page1.content.length).toBeGreaterThan(0);
    expect(page1.totalPages).toBeGreaterThan(1);
  });

  test("throws for unknown ids", async () => {
    await expect(
      readLargeResultTool.execute({ id: "lr_999", page: 1 }),
    ).rejects.toThrow();
  });

  test("throws for out-of-range pages", async () => {
    const id = storeLargeResult("fake_tool", "small");
    await expect(
      readLargeResultTool.execute({ id, page: 999 }),
    ).rejects.toThrow();
  });
});

describe("list_threads", () => {
  test("returns empty list when no threads", async () => {
    const r = await listThreadsTool.execute({}, ctx);
    expect(r.threads).toEqual([]);
    expect(r.count).toBe(0);
  });

  test("returns created threads", async () => {
    const a = await createThread(projectDir, "chat_session", undefined, "a");
    const b = await createThread(projectDir, "worker_tick", undefined, "b");
    const r = await listThreadsTool.execute({}, ctx);
    expect(r.count).toBe(2);
    const ids = r.threads.map((t) => t.id).sort();
    expect(ids).toEqual([a, b].sort());
  });

  test("filters by type", async () => {
    await createThread(projectDir, "chat_session", undefined, "chat");
    await createThread(projectDir, "worker_tick", undefined, "tick");
    const chats = await listThreadsTool.execute({ type: "chat_session" }, ctx);
    expect(chats.count).toBe(1);
    expect(chats.threads[0]?.title).toBe("chat");
  });

  test("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createThread(projectDir, "chat_session", undefined, `t-${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    const r = await listThreadsTool.execute({ limit: 2 }, ctx);
    expect(r.count).toBe(2);
  });
});
