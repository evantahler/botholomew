import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THREADS_DIR } from "../../src/constants.ts";
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
  reopenThread,
  updateThreadTitle,
} from "../../src/threads/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-threads-"));
  await mkdir(join(projectDir, THREADS_DIR), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("threads store (CSV)", () => {
  test("createThread writes a CSV under <projectDir>/threads/<date>/<id>.csv", async () => {
    const id = await createThread(
      projectDir,
      "chat_session",
      undefined,
      "Hello",
    );
    // Date is derived from the uuidv7 timestamp; we don't pin a specific
    // value (UTC date varies by clock), but it must be a YYYY-MM-DD subdir
    // and the file must live exactly one level under threads/.
    const root = join(projectDir, THREADS_DIR);
    const dateDirs = await readdir(root);
    expect(dateDirs).toHaveLength(1);
    expect(dateDirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const path = join(root, dateDirs[0] ?? "", `${id}.csv`);
    const text = await readFile(path, "utf-8");
    expect(text.startsWith("created_at,role,kind,content,")).toBe(true);
    expect(text).toContain("thread_meta");
    expect(text).toContain('"Hello"');
  });

  test("logInteraction appends rows; getThread reads them back in order", async () => {
    const id = await createThread(projectDir, "chat_session");
    await logInteraction(projectDir, id, {
      role: "user",
      kind: "message",
      content: "hi there",
    });
    await logInteraction(projectDir, id, {
      role: "assistant",
      kind: "message",
      content: "hello back",
      durationMs: 1234,
      tokenCount: 567,
    });
    const result = await getThread(projectDir, id);
    if (!result) throw new Error("missing");
    expect(result.interactions).toHaveLength(2);
    expect(result.interactions[0]?.content).toBe("hi there");
    expect(result.interactions[1]?.content).toBe("hello back");
    expect(result.interactions[1]?.duration_ms).toBe(1234);
    expect(result.interactions[1]?.token_count).toBe(567);
    expect(result.interactions[0]?.sequence).toBe(1);
    expect(result.interactions[1]?.sequence).toBe(2);
  });

  test("CSV escaping handles commas, quotes, and newlines in content", async () => {
    const id = await createThread(projectDir, "chat_session");
    const tricky =
      'line one with a "quote", a comma\nand a second line with "more"';
    await logInteraction(projectDir, id, {
      role: "user",
      kind: "message",
      content: tricky,
    });
    const result = await getThread(projectDir, id);
    expect(result?.interactions[0]?.content).toBe(tricky);
  });

  test("endThread marks the thread ended; reopenThread clears it", async () => {
    const id = await createThread(projectDir, "chat_session");
    expect(await isThreadEnded(projectDir, id)).toBe(false);
    await endThread(projectDir, id);
    expect(await isThreadEnded(projectDir, id)).toBe(true);
    await reopenThread(projectDir, id);
    expect(await isThreadEnded(projectDir, id)).toBe(false);
  });

  test("updateThreadTitle rewrites the meta row in place", async () => {
    const id = await createThread(projectDir, "chat_session", undefined, "old");
    await updateThreadTitle(projectDir, id, "new");
    const result = await getThread(projectDir, id);
    expect(result?.thread.title).toBe("new");
  });

  test("listThreads filters by type and returns newest-first", async () => {
    const a = await createThread(projectDir, "chat_session", undefined, "a");
    await new Promise((r) => setTimeout(r, 5));
    const b = await createThread(projectDir, "worker_tick", undefined, "b");
    const all = await listThreads(projectDir);
    expect(all.map((t) => t.id)).toEqual([b, a]);
    const chat = await listThreads(projectDir, { type: "chat_session" });
    expect(chat.map((t) => t.id)).toEqual([a]);
  });

  test("getActiveThread returns the most recent unended thread", async () => {
    const a = await createThread(projectDir, "chat_session", undefined, "a");
    await endThread(projectDir, a);
    const b = await createThread(projectDir, "chat_session", undefined, "b");
    const active = await getActiveThread(projectDir);
    expect(active?.id).toBe(b);
  });

  test("getInteractionsAfter returns only sequences > given index", async () => {
    const id = await createThread(projectDir, "chat_session");
    for (const text of ["a", "b", "c"]) {
      await logInteraction(projectDir, id, {
        role: "user",
        kind: "message",
        content: text,
      });
    }
    const after1 = await getInteractionsAfter(projectDir, id, 1);
    expect(after1.map((i) => i.content)).toEqual(["b", "c"]);
    const after3 = await getInteractionsAfter(projectDir, id, 3);
    expect(after3).toHaveLength(0);
  });

  test("deleteThread removes the CSV file", async () => {
    const id = await createThread(projectDir, "chat_session");
    expect(await deleteThread(projectDir, id)).toBe(true);
    expect(await getThread(projectDir, id)).toBeNull();
    expect(await deleteThread(projectDir, id)).toBe(false);
  });

  test("getActiveThread returns null when every thread has ended", async () => {
    const a = await createThread(projectDir, "chat_session");
    await endThread(projectDir, a);
    expect(await getActiveThread(projectDir)).toBeNull();
  });

  test("isThreadEnded reports active/ended correctly", async () => {
    const id = await createThread(projectDir, "chat_session");
    expect(await isThreadEnded(projectDir, id)).toBe(false);
    await endThread(projectDir, id);
    expect(await isThreadEnded(projectDir, id)).toBe(true);
  });

  test("listThreads supports limit and offset for paginated walks", async () => {
    for (let i = 0; i < 4; i++) {
      await createThread(projectDir, "chat_session", undefined, `t-${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    const page1 = await listThreads(projectDir, { limit: 2, offset: 0 });
    const page2 = await listThreads(projectDir, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    const ids = [...page1, ...page2].map((t) => t.id);
    expect(new Set(ids).size).toBe(4);
  });

  test("thread files live in date subdirectories derived from the id's uuidv7 timestamp", async () => {
    const a = await createThread(projectDir, "chat_session", undefined, "a");
    const b = await createThread(projectDir, "chat_session", undefined, "b");
    const root = join(projectDir, THREADS_DIR);
    const dateDirs = (await readdir(root)).sort();
    // Both threads created in the same test run land under the same UTC
    // date directory; in the rare midnight-rollover case they could split,
    // so we accept 1 or 2 dirs.
    expect(dateDirs.length).toBeGreaterThanOrEqual(1);
    for (const d of dateDirs) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The store's read-by-id path resolves the date dir without us telling
    // it which date to look in.
    expect((await getThread(projectDir, a))?.thread.title).toBe("a");
    expect((await getThread(projectDir, b))?.thread.title).toBe("b");
  });

  test("findThreadFile falls back to walking date subdirs for legacy/non-v7 ids", async () => {
    // Drop a hand-written CSV under a manually-chosen date dir (id is not
    // a uuidv7 — `dateFromUuidV7` will return null and the lookup must
    // fall back to a directory walk).
    const id = "legacy-id-no-v7-timestamp";
    const dateDir = join(projectDir, THREADS_DIR, "2026-05-04");
    await mkdir(dateDir, { recursive: true });
    const meta = JSON.stringify({
      type: "chat_session",
      task_id: null,
      title: "legacy",
      started_at: "2026-05-04T12:00:00.000Z",
    });
    await Bun.write(
      join(dateDir, `${id}.csv`),
      `created_at,role,kind,content,tool_name,tool_input,duration_ms,token_count\n2026-05-04T12:00:00.000Z,system,thread_meta,"${meta.replace(/"/g, '""')}",,,,\n`,
    );
    const result = await getThread(projectDir, id);
    expect(result?.thread.title).toBe("legacy");
  });

  test("malformed thread file is gracefully skipped by listThreads", async () => {
    await Bun.write(
      join(projectDir, THREADS_DIR, "broken.csv"),
      "not, valid, csv, header\nrandom rows",
    );
    const out = await listThreads(projectDir);
    expect(out).toEqual([]);
  });
});
