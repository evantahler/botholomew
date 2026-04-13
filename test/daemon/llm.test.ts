import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { createTask } from "../../src/db/tasks.ts";
import { createThread, getThread } from "../../src/db/threads.ts";
import { setupTestDb } from "../helpers.ts";

let mockCreate: ReturnType<typeof mock>;

// Mock the Anthropic SDK
mock.module("@anthropic-ai/sdk", () => {
  mockCreate = mock(async () => ({
    content: [
      { type: "text", text: "Done." },
      {
        type: "tool_use",
        id: "tool_1",
        name: "complete_task",
        input: { summary: "Task completed" },
      },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 50 },
  }));

  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

const { runAgentLoop } = await import("../../src/daemon/llm.ts");

let conn: DbConnection;

const testConfig = {
  anthropic_api_key: "test-key",
  model: "claude-opus-4-20250514",
  chunker_model: "claude-haiku-4-20250514",
  tick_interval_seconds: 300,
  max_tick_duration_seconds: 120,
  system_prompt_override: "",
};

beforeEach(() => {
  conn = setupTestDb();
  mockCreate.mockClear();
});

describe("runAgentLoop", () => {
  test("completes when agent calls complete_task", async () => {
    const task = await createTask(conn, {
      name: "Test task",
      description: "Do something",
    });
    const threadId = await createThread(conn, "daemon_tick", task.id);

    mockCreate.mockImplementation(async () => ({
      content: [
        { type: "text", text: "I will complete this." },
        {
          type: "tool_use",
          id: "tool_1",
          name: "complete_task",
          input: { summary: "All done" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    const result = await runAgentLoop({
      systemPrompt: "You are a test agent.",
      task,
      config: testConfig,
      conn,
      threadId,
      projectDir: "/tmp/test",
    });

    expect(result.status).toBe("complete");
    expect(result.reason).toBe("All done");
  });

  test("returns failed when agent calls fail_task", async () => {
    const task = await createTask(conn, {
      name: "Failing task",
      description: "This will fail",
    });
    const threadId = await createThread(conn, "daemon_tick", task.id);

    mockCreate.mockImplementation(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "fail_task",
          input: { reason: "Cannot proceed" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    const result = await runAgentLoop({
      systemPrompt: "You are a test agent.",
      task,
      config: testConfig,
      conn,
      threadId,
      projectDir: "/tmp/test",
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("Cannot proceed");
  });

  test("returns waiting when agent calls wait_task", async () => {
    const task = await createTask(conn, {
      name: "Waiting task",
      description: "Needs to wait",
    });
    const threadId = await createThread(conn, "daemon_tick", task.id);

    mockCreate.mockImplementation(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "wait_task",
          input: { reason: "Waiting for dependency" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    const result = await runAgentLoop({
      systemPrompt: "You are a test agent.",
      task,
      config: testConfig,
      conn,
      threadId,
      projectDir: "/tmp/test",
    });

    expect(result.status).toBe("waiting");
    expect(result.reason).toBe("Waiting for dependency");
  });

  test("returns complete when agent responds with no tool use", async () => {
    const task = await createTask(conn, {
      name: "Simple task",
      description: "Just text response",
    });
    const threadId = await createThread(conn, "daemon_tick", task.id);

    mockCreate.mockImplementation(async () => ({
      content: [{ type: "text", text: "I completed the task implicitly." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    const result = await runAgentLoop({
      systemPrompt: "You are a test agent.",
      task,
      config: testConfig,
      conn,
      threadId,
      projectDir: "/tmp/test",
    });

    expect(result.status).toBe("complete");
    expect(result.reason).toContain("without explicit status tool call");
  });

  test("returns failed when max turns exceeded", async () => {
    const task = await createTask(conn, {
      name: "Infinite task",
      description: "Never completes",
    });
    const threadId = await createThread(conn, "daemon_tick", task.id);

    // Always return a non-terminal tool use so the loop continues.
    // Use file_exists which never throws (always returns a result).
    let turnCounter = 0;
    mockCreate.mockImplementation(async () => ({
      content: [
        {
          type: "tool_use",
          id: `tool_${++turnCounter}`,
          name: "file_exists",
          input: { path: "/anything.txt" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    const result = await runAgentLoop({
      systemPrompt: "You are a test agent.",
      task,
      config: testConfig,
      conn,
      threadId,
      projectDir: "/tmp/test",
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("Max turns exceeded");
  });

  test("handles unknown tool gracefully", async () => {
    const task = await createTask(conn, {
      name: "Unknown tool task",
      description: "Calls a non-existent tool",
    });
    const threadId = await createThread(conn, "daemon_tick", task.id);

    let callCount = 0;
    mockCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "nonexistent_tool",
              input: {},
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 50, output_tokens: 30 },
        };
      }
      // Second call: agent gives up
      return {
        content: [
          {
            type: "tool_use",
            id: "tool_2",
            name: "complete_task",
            input: { summary: "Recovered" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 30 },
      };
    });

    const result = await runAgentLoop({
      systemPrompt: "You are a test agent.",
      task,
      config: testConfig,
      conn,
      threadId,
      projectDir: "/tmp/test",
    });

    // Should recover and complete after unknown tool error
    expect(result.status).toBe("complete");
  });

  test("logs all interactions to thread", async () => {
    const task = await createTask(conn, {
      name: "Logged task",
      description: "Should log interactions",
    });
    const threadId = await createThread(conn, "daemon_tick", task.id);

    mockCreate.mockImplementation(async () => ({
      content: [
        { type: "text", text: "Working on it." },
        {
          type: "tool_use",
          id: "tool_1",
          name: "complete_task",
          input: { summary: "Done" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    await runAgentLoop({
      systemPrompt: "You are a test agent.",
      task,
      config: testConfig,
      conn,
      threadId,
      projectDir: "/tmp/test",
    });

    const threadData = await getThread(conn, threadId);
    expect(threadData).not.toBeNull();

    const kinds = threadData?.interactions.map((i) => i.kind);
    // Should have: user message, assistant message, tool_use, tool_result
    expect(kinds).toContain("message");
    expect(kinds).toContain("tool_use");
    expect(kinds).toContain("tool_result");

    // Verify user message was logged first
    const userInteraction = threadData?.interactions.find(
      (i) => i.role === "user",
    );
    expect(userInteraction).toBeDefined();
    expect(userInteraction?.content).toContain("Logged task");
  });
});
