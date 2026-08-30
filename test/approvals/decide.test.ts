import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideAndRequeue } from "../../src/approvals/decide.ts";
import { createApproval } from "../../src/approvals/store.ts";
import { getTasksDir, getTasksLockDir } from "../../src/constants.ts";
import {
  claimSpecificTask,
  createTask,
  getTask,
} from "../../src/tasks/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-decide-"));
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("decideAndRequeue", () => {
  test("approving re-queues the originating task to pending", async () => {
    const task = await createTask(projectDir, { name: "send the report" });
    // Simulate the worker having parked it as waiting.
    await claimSpecificTask(projectDir, task.id, "worker-1");
    const { updateTaskStatus } = await import("../../src/tasks/store.ts");
    await updateTaskStatus(projectDir, task.id, "waiting", "Awaiting approval");

    const a = await createApproval(projectDir, {
      server: "gmail",
      tool: "send_email",
      task_id: task.id,
    });

    const decided = await decideAndRequeue(projectDir, a.id, "approved", "cli");
    expect(decided?.status).toBe("approved");

    const fresh = await getTask(projectDir, task.id);
    expect(fresh?.status).toBe("pending");
  });

  test("denying also re-queues so the agent can recover", async () => {
    const task = await createTask(projectDir, { name: "do thing" });
    const a = await createApproval(projectDir, {
      server: "s",
      tool: "t",
      task_id: task.id,
    });
    const decided = await decideAndRequeue(projectDir, a.id, "denied", "cli");
    expect(decided?.status).toBe("denied");
    expect((await getTask(projectDir, task.id))?.status).toBe("pending");
  });

  test("returns null for a missing or already-decided approval", async () => {
    expect(
      await decideAndRequeue(projectDir, "nope", "approved", "x"),
    ).toBeNull();
    const a = await createApproval(projectDir, { server: "s", tool: "t" });
    await decideAndRequeue(projectDir, a.id, "approved", "x");
    expect(await decideAndRequeue(projectDir, a.id, "denied", "x")).toBeNull();
  });

  test("membot_run batch waits until every interruption is decided", async () => {
    const task = await createTask(projectDir, { name: "batch" });
    const { updateTaskStatus } = await import("../../src/tasks/store.ts");
    await updateTaskStatus(projectDir, task.id, "waiting", "Awaiting approval");

    const first = await createApproval(projectDir, {
      server: "gmail",
      tool: "send",
      task_id: task.id,
      run_id: "run-1",
      interruption_id: "interrupt-1",
    });
    const second = await createApproval(projectDir, {
      server: "slack",
      tool: "post",
      task_id: task.id,
      run_id: "run-1",
      interruption_id: "interrupt-2",
    });

    await decideAndRequeue(projectDir, first.id, "approved", "cli");
    expect((await getTask(projectDir, task.id))?.status).toBe("waiting");

    await decideAndRequeue(projectDir, second.id, "denied", "cli");
    expect((await getTask(projectDir, task.id))?.status).toBe("pending");
  });

  test("no task_id: decides without throwing", async () => {
    const a = await createApproval(projectDir, { server: "s", tool: "t" });
    const decided = await decideAndRequeue(projectDir, a.id, "approved", "x");
    expect(decided?.status).toBe("approved");
  });
});
