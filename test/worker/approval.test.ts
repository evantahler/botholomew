import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolApprovalRequest } from "@evantahler/mcpx";
import { ApprovalPendingError } from "../../src/approvals/errors.ts";
import {
  callKey,
  createApproval,
  decideApproval,
  findByCallKey,
  getApproval,
  listApprovals,
} from "../../src/approvals/store.ts";
import {
  makeWorkerApprovalCallback,
  type WorkerApprovalCtx,
} from "../../src/worker/approval.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-wapproval-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function req(over: Partial<ToolApprovalRequest> = {}): ToolApprovalRequest {
  return {
    server: "gmail",
    tool: "send_email",
    args: { to: "x" },
    reason: "not-allowlisted",
    schema: { name: "send_email", inputSchema: { type: "object" } },
    annotations: undefined,
    ...over,
  } as ToolApprovalRequest;
}

describe("makeWorkerApprovalCallback", () => {
  test("no prior record: creates a pending approval and throws", async () => {
    const ctx: WorkerApprovalCtx = { taskId: "task-1", threadId: "thread-1" };
    const cb = makeWorkerApprovalCallback(projectDir, "worker-1", ctx);

    await expect(cb(req())).rejects.toBeInstanceOf(ApprovalPendingError);

    const pending = await listApprovals(projectDir, { status: "pending" });
    expect(pending.length).toBe(1);
    expect(pending[0]?.task_id).toBe("task-1");
    expect(pending[0]?.worker_id).toBe("worker-1");
    expect(pending[0]?.server).toBe("gmail");
  });

  test("existing pending record: throws without creating a duplicate", async () => {
    const ctx: WorkerApprovalCtx = { taskId: "t", threadId: "th" };
    const cb = makeWorkerApprovalCallback(projectDir, "w", ctx);
    await expect(cb(req())).rejects.toBeInstanceOf(ApprovalPendingError);
    await expect(cb(req())).rejects.toBeInstanceOf(ApprovalPendingError);
    expect((await listApprovals(projectDir)).length).toBe(1);
  });

  test("approved record: returns true and consumes it", async () => {
    const ctx: WorkerApprovalCtx = { taskId: "t", threadId: "th" };
    const a = await createApproval(projectDir, {
      server: "gmail",
      tool: "send_email",
      args: { to: "x" },
    });
    await decideApproval(projectDir, a.id, "approved", "cli");

    const cb = makeWorkerApprovalCallback(projectDir, "w", ctx);
    await expect(cb(req())).resolves.toBe(true);

    // consumed — gone from disk
    expect(await getApproval(projectDir, a.id)).toBeNull();
  });

  test("denied record: returns false (stays on disk)", async () => {
    const ctx: WorkerApprovalCtx = { taskId: "t", threadId: "th" };
    const a = await createApproval(projectDir, {
      server: "gmail",
      tool: "send_email",
      args: { to: "x" },
    });
    await decideApproval(projectDir, a.id, "denied", "cli");

    const cb = makeWorkerApprovalCallback(projectDir, "w", ctx);
    await expect(cb(req())).resolves.toBe(false);
    expect(await getApproval(projectDir, a.id)).not.toBeNull();
  });

  test("created record carries the exact call_key for the request", async () => {
    const ctx: WorkerApprovalCtx = { taskId: "t", threadId: "th" };
    const cb = makeWorkerApprovalCallback(projectDir, "w", ctx);
    await expect(cb(req())).rejects.toBeInstanceOf(ApprovalPendingError);
    const found = await findByCallKey(
      projectDir,
      callKey("gmail", "send_email", { to: "x" }),
    );
    expect(found).not.toBeNull();
  });
});
