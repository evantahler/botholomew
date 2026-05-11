/**
 * runAgentLoop is the worker tool-use loop. tick.test.ts covers the
 * happy path (complete/wait/throw) end-to-end via tick(); this file
 * exercises the loop's edge cases directly: no-tool-use returns
 * complete, max-turns returns failed, an unknown tool yields a
 * recoverable error result, multiple tool calls dispatch in parallel.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MembotClient } from "membot";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import {
  getTasksDir,
  getTasksLockDir,
  getThreadsDir,
} from "../../src/constants.ts";
import { openMembot } from "../../src/mem/client.ts";
import { createTask } from "../../src/tasks/store.ts";
import { createThread } from "../../src/threads/store.ts";

let mockResponse: () => unknown = () => completionResponseLocal();

function completionResponseLocal() {
  return {
    content: [
      { type: "text", text: "All done." },
      {
        type: "tool_use",
        id: "tool_1",
        name: "complete_task",
        input: { summary: "ok" },
      },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => mockResponse(),
    };
  },
}));

const { runAgentLoop } = await import("../../src/worker/llm.ts");

const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
  max_turns: 5,
} as Required<typeof DEFAULT_CONFIG>;

let projectDir: string;
let mem: MembotClient;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-llm-"));
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
  await mkdir(getThreadsDir(projectDir), { recursive: true });
  mem = openMembot(projectDir);
  await mem.connect();
  mockResponse = () => completionResponseLocal();
});

afterEach(async () => {
  await mem.close();
  await rm(projectDir, { recursive: true, force: true });
});

async function fixture() {
  const task = await createTask(projectDir, {
    name: "test",
    description: "do",
  });
  const threadId = await createThread(projectDir, "worker_tick", task.id);
  return { task, threadId };
}

describe("runAgentLoop", () => {
  test("returns complete when the agent calls complete_task", async () => {
    const { task, threadId } = await fixture();
    const result = await runAgentLoop({
      systemPrompt: "test prompt",
      task,
      config: TEST_CONFIG,
      mem,
      threadId,
      projectDir,
    });
    expect(result.status).toBe("complete");
    expect(result.reason).toBe("ok");
  });

  test("returns failed when the agent calls fail_task", async () => {
    mockResponse = () => ({
      content: [
        { type: "text", text: "I cannot proceed." },
        {
          type: "tool_use",
          id: "tool_1",
          name: "fail_task",
          input: { reason: "Insurmountable obstacle" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const { task, threadId } = await fixture();
    const result = await runAgentLoop({
      systemPrompt: "p",
      task,
      config: TEST_CONFIG,
      mem,
      threadId,
      projectDir,
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("Insurmountable obstacle");
  });

  test("returns waiting when the agent calls wait_task", async () => {
    mockResponse = () => ({
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "wait_task",
          input: { reason: "Need approval" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const { task, threadId } = await fixture();
    const result = await runAgentLoop({
      systemPrompt: "p",
      task,
      config: TEST_CONFIG,
      mem,
      threadId,
      projectDir,
    });
    expect(result.status).toBe("waiting");
    expect(result.reason).toBe("Need approval");
  });

  test("returns complete when the agent responds with no tool_use", async () => {
    mockResponse = () => ({
      content: [{ type: "text", text: "I think I'm done." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const { task, threadId } = await fixture();
    const result = await runAgentLoop({
      systemPrompt: "p",
      task,
      config: TEST_CONFIG,
      mem,
      threadId,
      projectDir,
    });
    expect(result.status).toBe("complete");
    expect(result.reason).toContain("without explicit status");
  });

  test("returns failed when max_turns is exceeded", async () => {
    // Always emit a non-terminal tool call so the loop never settles.
    mockResponse = () => ({
      content: [
        {
          type: "tool_use",
          id: `tool_${Math.random()}`,
          name: "list_tasks",
          input: {},
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const { task, threadId } = await fixture();
    const result = await runAgentLoop({
      systemPrompt: "p",
      task,
      config: { ...TEST_CONFIG, max_turns: 2 },
      mem,
      threadId,
      projectDir,
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("Max turns");
  });

  test("handles an unknown tool gracefully (records error, keeps going to terminal)", async () => {
    let turn = 0;
    mockResponse = () => {
      turn++;
      if (turn === 1) {
        return {
          content: [
            {
              type: "tool_use",
              id: "tool_unknown",
              name: "no_such_tool",
              input: {},
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      }
      return completionResponseLocal();
    };
    const { task, threadId } = await fixture();
    const result = await runAgentLoop({
      systemPrompt: "p",
      task,
      config: TEST_CONFIG,
      mem,
      threadId,
      projectDir,
    });
    // The agent recovered: turn 1 errored, turn 2 completed.
    expect(result.status).toBe("complete");
  });

  test("injects predecessor task outputs into the user message", async () => {
    // The blocker task gets a real `output`; runAgentLoop should stitch it
    // into the user message so the agent doesn't have to re-derive findings.
    const blocker = await createTask(projectDir, {
      name: "Read email",
      description: "scan inbox",
    });
    const { updateTaskStatus } = await import("../../src/tasks/store.ts");
    await updateTaskStatus(
      projectDir,
      blocker.id,
      "complete",
      null,
      "3 urgent threads from customers",
    );
    const downstream = await createTask(projectDir, {
      name: "Summarize urgent items",
      description: "based on inbox scan",
      blocked_by: [blocker.id],
    });

    let capturedUserText = "";
    mockResponse = () => {
      // The mock receives the messages on each call; no direct way to inspect
      // them here. Instead, we let runAgentLoop log to the thread CSV and
      // read the user-message interaction back below.
      return completionResponseLocal();
    };

    const threadId = await createThread(
      projectDir,
      "worker_tick",
      downstream.id,
    );
    await runAgentLoop({
      systemPrompt: "p",
      task: downstream,
      config: TEST_CONFIG,
      mem,
      threadId,
      projectDir,
    });

    const { getThread } = await import("../../src/threads/store.ts");
    const t = await getThread(projectDir, threadId);
    const userInteraction = t?.interactions.find(
      (i) => i.role === "user" && i.kind === "message",
    );
    capturedUserText = userInteraction?.content ?? "";
    expect(capturedUserText).toContain("Predecessor Task Outputs");
    expect(capturedUserText).toContain("Read email");
    expect(capturedUserText).toContain("3 urgent threads from customers");
  });

  test("dispatches multiple tool calls per turn in parallel", async () => {
    let turn = 0;
    mockResponse = () => {
      turn++;
      if (turn === 1) {
        return {
          content: [
            {
              type: "tool_use",
              id: "a",
              name: "list_tasks",
              input: {},
            },
            {
              type: "tool_use",
              id: "b",
              name: "list_threads",
              input: {},
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      }
      return completionResponseLocal();
    };
    const { task, threadId } = await fixture();
    const result = await runAgentLoop({
      systemPrompt: "p",
      task,
      config: TEST_CONFIG,
      mem,
      threadId,
      projectDir,
    });
    expect(result.status).toBe("complete");
    expect(turn).toBe(2);
  });
});
