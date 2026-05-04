import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_DIR } from "../../src/constants.ts";
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
  await mkdir(join(projectDir, CONTEXT_DIR, "threads"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("threads store (CSV)", () => {
  test("createThread writes a CSV with header + thread_meta row", async () => {
    const id = await createThread(
      projectDir,
      "chat_session",
      undefined,
      "Hello",
    );
    const path = join(projectDir, CONTEXT_DIR, "threads", `${id}.csv`);
    const text = await readFile(path, "utf-8");
    expect(text.startsWith("created_at,role,kind,content,")).toBe(true);
    expect(text).toContain("thread_meta");
    expect(text).toContain('"Hello"'); // title round-trips through JSON encoding
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

  test("malformed thread file is gracefully skipped by listThreads", async () => {
    await Bun.write(
      join(projectDir, CONTEXT_DIR, "threads", "broken.csv"),
      "not, valid, csv, header\nrandom rows",
    );
    const out = await listThreads(projectDir);
    expect(out).toEqual([]);
  });
});
