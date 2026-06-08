import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvalFilePath,
  callKey,
  consumeApproval,
  createApproval,
  decideApproval,
  findByCallKey,
  getApproval,
  listApprovals,
} from "../../src/approvals/store.ts";
import { APPROVALS_DIR } from "../../src/constants.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-approvals-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("callKey", () => {
  test("is stable regardless of argument key order", () => {
    const a = callKey("gmail", "send", { to: "x", subject: "y" });
    const b = callKey("gmail", "send", { subject: "y", to: "x" });
    expect(a).toBe(b);
  });

  test("differs when server, tool, or args differ", () => {
    const base = callKey("gmail", "send", { to: "x" });
    expect(callKey("slack", "send", { to: "x" })).not.toBe(base);
    expect(callKey("gmail", "draft", { to: "x" })).not.toBe(base);
    expect(callKey("gmail", "send", { to: "z" })).not.toBe(base);
  });

  test("treats missing args as empty object", () => {
    expect(callKey("s", "t", undefined)).toBe(callKey("s", "t", {}));
  });
});

describe("createApproval + getApproval", () => {
  test("writes a markdown file with frontmatter under approvals/", async () => {
    const a = await createApproval(projectDir, {
      server: "gmail",
      tool: "send_email",
      args: { to: "a@b.c" },
      reason: "not-allowlisted",
      task_id: "task-1",
      thread_id: "thread-1",
      worker_id: "worker-1",
    });
    expect(a.id).toBeTruthy();
    expect(a.status).toBe("pending");
    expect(a.server).toBe("gmail");
    expect(a.call_key).toBe(callKey("gmail", "send_email", { to: "a@b.c" }));
    expect(JSON.parse(a.args)).toEqual({ to: "a@b.c" });

    const raw = await readFile(
      join(projectDir, APPROVALS_DIR, `${a.id}.md`),
      "utf-8",
    );
    expect(raw.startsWith("---\n")).toBe(true);

    const fetched = await getApproval(projectDir, a.id);
    expect(fetched?.id).toBe(a.id);
    expect(fetched?.task_id).toBe("task-1");
  });

  test("getApproval returns null for a missing id", async () => {
    expect(await getApproval(projectDir, "nope")).toBeNull();
  });
});

describe("listApprovals", () => {
  test("filters by status and is newest-first with limit/offset", async () => {
    const a1 = await createApproval(projectDir, { server: "s", tool: "a" });
    const a2 = await createApproval(projectDir, { server: "s", tool: "b" });
    const a3 = await createApproval(projectDir, { server: "s", tool: "c" });
    await decideApproval(projectDir, a2.id, "approved", "tester");

    const all = await listApprovals(projectDir);
    expect(all.map((a) => a.id)).toEqual([a3.id, a2.id, a1.id]);

    const pending = await listApprovals(projectDir, { status: "pending" });
    expect(pending.map((a) => a.id)).toEqual([a3.id, a1.id]);

    const page = await listApprovals(projectDir, { limit: 1, offset: 1 });
    expect(page.map((a) => a.id)).toEqual([a2.id]);
  });
});

describe("decideApproval", () => {
  test("records the decision and decided_by/decided_at", async () => {
    const a = await createApproval(projectDir, { server: "s", tool: "t" });
    const decided = await decideApproval(projectDir, a.id, "denied", "cli");
    expect(decided.status).toBe("denied");
    expect(decided.decided_by).toBe("cli");
    expect(decided.decided_at).not.toBeNull();
  });
});

describe("findByCallKey", () => {
  test("returns the most-recent record for a key, or null", async () => {
    const args = { to: "x" };
    expect(await findByCallKey(projectDir, callKey("s", "t", args))).toBeNull();
    const a = await createApproval(projectDir, {
      server: "s",
      tool: "t",
      args,
    });
    const found = await findByCallKey(projectDir, callKey("s", "t", args));
    expect(found?.id).toBe(a.id);
  });
});

describe("consumeApproval", () => {
  test("deletes the record so a later call re-prompts", async () => {
    const a = await createApproval(projectDir, { server: "s", tool: "t" });
    expect(await consumeApproval(projectDir, a.id)).toBe(true);
    expect(await getApproval(projectDir, a.id)).toBeNull();
    // file is gone
    expect(await Bun.file(approvalFilePath(projectDir, a.id)).exists()).toBe(
      false,
    );
    // consuming a missing one is a no-op false
    expect(await consumeApproval(projectDir, a.id)).toBe(false);
  });
});
