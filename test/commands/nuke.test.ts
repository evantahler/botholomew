/**
 * Tests for the nuke command's underlying delete-all primitives. The
 * commander wrapper exits the process on missing --yes / running workers,
 * so we cover the same logic by exercising deleteAllTasks/Schedules/
 * Threads + the context-dir wipe directly.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSchedulesDir,
  getSchedulesLockDir,
  getTasksDir,
  getTasksLockDir,
  getThreadsDir,
  getWorkersDir,
} from "../../src/constants.ts";
import {
  createSchedule,
  deleteAllSchedules,
} from "../../src/schedules/store.ts";
import { createTask, deleteAllTasks } from "../../src/tasks/store.ts";
import {
  createThread,
  deleteAllThreads,
  listThreads,
  logInteraction,
} from "../../src/threads/store.ts";
import { listWorkers, registerWorker } from "../../src/workers/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-nuke-"));
  for (const dir of [
    getTasksDir(projectDir),
    getTasksLockDir(projectDir),
    getSchedulesDir(projectDir),
    getSchedulesLockDir(projectDir),
    getThreadsDir(projectDir),
    getWorkersDir(projectDir),
  ]) {
    await mkdir(dir, { recursive: true });
  }
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("nuke primitives", () => {
  test("deleteAllTasks unlinks every tasks/<id>.md and reports the count", async () => {
    await createTask(projectDir, { name: "a" });
    await createTask(projectDir, { name: "b" });
    expect(await deleteAllTasks(projectDir)).toBe(2);
  });

  test("deleteAllSchedules unlinks every schedules/<id>.md and reports the count", async () => {
    await createSchedule(projectDir, { name: "a", frequency: "daily" });
    await createSchedule(projectDir, { name: "b", frequency: "weekly" });
    expect(await deleteAllSchedules(projectDir)).toBe(2);
  });

  test("deleteAllThreads unlinks every threads/<date>/<id>.csv and counts threads + interactions", async () => {
    const a = await createThread(projectDir, "chat_session");
    await logInteraction(projectDir, a, {
      role: "user",
      kind: "message",
      content: "x",
    });
    await logInteraction(projectDir, a, {
      role: "assistant",
      kind: "message",
      content: "y",
    });
    const b = await createThread(projectDir, "worker_tick");
    await logInteraction(projectDir, b, {
      role: "user",
      kind: "message",
      content: "z",
    });

    const r = await deleteAllThreads(projectDir);
    expect(r.threads).toBe(2);
    expect(r.interactions).toBeGreaterThanOrEqual(3);
    expect(await listThreads(projectDir)).toEqual([]);
  });

  test("nuke leaves prompts/, skills/, mcpx/, config/ alone", async () => {
    // Sanity: the nuke verbs in src/commands/nuke.ts only touch the membot
    // store and tasks/, schedules/, threads/. Other dirs aren't imported.
    const prompts = join(projectDir, "prompts");
    await mkdir(prompts, { recursive: true });
    await writeFile(join(prompts, "soul.md"), "I am.");

    await deleteAllTasks(projectDir);
    await deleteAllSchedules(projectDir);
    await deleteAllThreads(projectDir);

    expect(await Bun.file(join(prompts, "soul.md")).exists()).toBe(true);
  });
});

describe("nuke safety: detect running workers", () => {
  test("listWorkers({status:'running'}) reports the worker that would block nuke", async () => {
    await registerWorker(projectDir, {
      id: "alive-1",
      pid: process.pid,
      hostname: "test",
      mode: "persist",
    });
    const running = await listWorkers(projectDir, { status: "running" });
    expect(running.map((w) => w.id)).toContain("alive-1");
  });
});
