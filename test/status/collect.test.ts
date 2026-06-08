import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/loader.ts";
import {
  getSchedulesDir,
  getSchedulesLockDir,
  getTasksDir,
  getTasksLockDir,
  getWorkersDir,
} from "../../src/constants.ts";
import { createSchedule } from "../../src/schedules/store.ts";
import { collectStatus } from "../../src/status/collect.ts";
import {
  claimNextTask,
  createTask,
  taskFilePath,
  updateTaskStatus,
} from "../../src/tasks/store.ts";
import { registerWorker } from "../../src/workers/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-status-"));
  for (const dir of [
    getTasksDir(projectDir),
    getTasksLockDir(projectDir),
    getSchedulesDir(projectDir),
    getSchedulesLockDir(projectDir),
    getWorkersDir(projectDir),
  ]) {
    await mkdir(dir, { recursive: true });
  }
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function collect() {
  const config = await loadConfig(projectDir);
  return collectStatus(projectDir, config, { evaluateSchedules: false });
}

describe("collectStatus — workers", () => {
  test("buckets workers by status and reports the latest heartbeat", async () => {
    await registerWorker(projectDir, {
      id: "w-running",
      pid: process.pid,
      hostname: "test",
      mode: "persist",
    });
    await registerWorker(projectDir, {
      id: "w-once",
      pid: process.pid,
      hostname: "test",
      mode: "once",
    });

    const report = await collect();
    expect(report.workers.total).toBe(2);
    expect(report.workers.running).toBe(2);
    expect(report.workers.stopped).toBe(0);
    expect(report.workers.dead).toBe(0);
    expect(report.workers.latest_heartbeat_at).not.toBeNull();
    expect(report.workers.list.map((w) => w.id).sort()).toEqual([
      "w-once",
      "w-running",
    ]);
  });

  test("no workers → zeros and null heartbeat", async () => {
    const report = await collect();
    expect(report.workers.total).toBe(0);
    expect(report.workers.latest_heartbeat_at).toBeNull();
  });
});

describe("collectStatus — tasks", () => {
  test("counts by status and surfaces claimed in_progress tasks with owners", async () => {
    await createTask(projectDir, { name: "pending-1" });
    const done = await createTask(projectDir, { name: "done-1" });
    await updateTaskStatus(projectDir, done.id, "complete");

    const claimed = await claimNextTask(projectDir, "worker-xyz");
    expect(claimed).not.toBeNull();

    const report = await collect();
    expect(report.tasks.total).toBe(2);
    expect(report.tasks.by_status.complete).toBe(1);
    expect(report.tasks.by_status.in_progress).toBe(1);
    expect(report.tasks.by_status.pending).toBe(0);

    expect(report.tasks.claimed).toHaveLength(1);
    expect(report.tasks.claimed[0]?.claimed_by).toBe("worker-xyz");
    expect(report.tasks.claimed[0]?.id).toBe(claimed?.id);
  });

  test("malformed task files are quarantined, not counted", async () => {
    await createTask(projectDir, { name: "good" });
    await writeFile(
      taskFilePath(projectDir, "broken"),
      "---\nthis: [is not valid frontmatter\n---\nbody",
    );

    const report = await collect();
    expect(report.tasks.total).toBe(1);
    expect(report.tasks.quarantined).toHaveLength(1);
    expect(report.tasks.quarantined[0]?.id).toBe("broken");
    expect(report.tasks.quarantined[0]?.reason).toBeTruthy();
  });
});

describe("collectStatus — schedules", () => {
  test("counts enabled vs disabled; no evaluation when evaluateSchedules is false", async () => {
    await createSchedule(projectDir, {
      name: "daily",
      frequency: "every day",
      enabled: true,
    });
    await createSchedule(projectDir, {
      name: "off",
      frequency: "weekly",
      enabled: false,
    });

    const report = await collect();
    expect(report.schedules.total).toBe(2);
    expect(report.schedules.enabled).toBe(1);
    expect(report.schedules.disabled).toBe(1);
    for (const e of report.schedules.list) {
      expect(e.evaluation).toBeUndefined();
    }
  });
});

describe("collectStatus — store", () => {
  test("resolves membot/mcpx scope and dirs from config", async () => {
    const report = await collect();
    const config = await loadConfig(projectDir);
    expect(report.store.membot_scope).toBe(config.membot_scope);
    expect(report.store.mcpx_scope).toBe(config.mcpx_scope);
    expect(report.store.membot_dir).toBeTruthy();
    expect(report.store.mcpx_dir).toBeTruthy();
  });
});
