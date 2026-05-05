/**
 * Worker tick orchestration: claim a task, run the agent loop with a
 * mocked LLM that immediately calls a terminal tool (complete/fail/wait),
 * then update the task and close the thread. Anthropic SDK is module-
 * mocked so we never hit the wire.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import {
  getDbPath,
  getSchedulesDir,
  getSchedulesLockDir,
  getTasksDir,
  getTasksLockDir,
  getThreadsDir,
  getWorkersDir,
} from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import { createTask, getTask } from "../../src/tasks/store.ts";
import { listThreads } from "../../src/threads/store.ts";
import { completionResponse } from "../helpers.ts";

let mockResponse: () => unknown = () => completionResponse();

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => mockResponse(),
    };
  },
}));

const { tick } = await import("../../src/worker/tick.ts");

const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
} as Required<typeof DEFAULT_CONFIG>;

let projectDir: string;
let dbPath: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-tick-"));
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
  await mkdir(getSchedulesDir(projectDir), { recursive: true });
  await mkdir(getSchedulesLockDir(projectDir), { recursive: true });
  await mkdir(getThreadsDir(projectDir), { recursive: true });
  await mkdir(getWorkersDir(projectDir), { recursive: true });

  dbPath = getDbPath(projectDir);
  // Tools wrap their conn in withDb(dbPath, ...) — index.duckdb must exist
  // and be migrated for any tool to run, even ones that don't read from it.
  const conn = await getConnection(dbPath);
  await migrate(conn);
  conn.close();

  mockResponse = () => completionResponse();
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("worker tick", () => {
  test("claims a task and marks it complete via complete_task", async () => {
    const task = await createTask(projectDir, {
      name: "Test task",
      description: "do a thing",
    });

    const didWork = await tick({
      projectDir,
      dbPath,
      config: TEST_CONFIG,
      workerId: "worker-A",
      evalSchedules: false,
    });

    expect(didWork).toBe(true);
    const updated = await getTask(projectDir, task.id);
    expect(updated?.status).toBe("complete");
    expect(updated?.output).toBe("Task done successfully");
    expect(updated?.waiting_reason).toBeNull();
  });

  test("returns false and creates no threads when no tasks are available", async () => {
    const didWork = await tick({
      projectDir,
      dbPath,
      config: TEST_CONFIG,
      workerId: "worker-A",
      evalSchedules: false,
    });
    expect(didWork).toBe(false);
    expect(await listThreads(projectDir)).toHaveLength(0);
  });

  test("marks task as failed when the LLM throws", async () => {
    mockResponse = () => {
      throw new Error("API rate limit exceeded");
    };
    const task = await createTask(projectDir, {
      name: "Will fail",
      description: "x",
    });
    await tick({
      projectDir,
      dbPath,
      config: TEST_CONFIG,
      workerId: "worker-A",
      evalSchedules: false,
    });
    const updated = await getTask(projectDir, task.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.waiting_reason).toContain("API rate limit");
    expect(updated?.output).toBeNull();
  });

  test("marks task as waiting when the agent calls wait_task", async () => {
    mockResponse = () => ({
      content: [
        { type: "text", text: "Need approval first." },
        {
          type: "tool_use",
          id: "tool_1",
          name: "wait_task",
          input: { reason: "Need user approval" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const task = await createTask(projectDir, {
      name: "Will wait",
      description: "x",
    });
    await tick({
      projectDir,
      dbPath,
      config: TEST_CONFIG,
      workerId: "worker-A",
      evalSchedules: false,
    });
    const updated = await getTask(projectDir, task.id);
    expect(updated?.status).toBe("waiting");
    expect(updated?.waiting_reason).toBe("Need user approval");
    expect(updated?.output).toBeNull();
  });

  test("processes highest-priority task first", async () => {
    const lo = await createTask(projectDir, {
      name: "low",
      description: "d",
      priority: "low",
    });
    const hi = await createTask(projectDir, {
      name: "high",
      description: "d",
      priority: "high",
    });
    await tick({
      projectDir,
      dbPath,
      config: TEST_CONFIG,
      workerId: "worker-A",
      evalSchedules: false,
    });
    const high = await getTask(projectDir, hi.id);
    const low = await getTask(projectDir, lo.id);
    expect(high?.status).toBe("complete");
    expect(low?.status).toBe("pending");
  });
});
