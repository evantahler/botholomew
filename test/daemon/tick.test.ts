import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { createTask, getTask } from "../../src/db/tasks.ts";
import { getThread, listThreads } from "../../src/db/threads.ts";
import { setupTestDb } from "../helpers.ts";

// Mock the Anthropic SDK before importing tick
mock.module("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: async () => ({
          content: [
            { type: "text", text: "I'll complete this task." },
            {
              type: "tool_use",
              id: "tool_1",
              name: "complete_task",
              input: { summary: "Task done successfully" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      };
    },
  };
});

// Import tick after mocking
const { tick } = await import("../../src/daemon/tick.ts");

let conn: DbConnection;

beforeEach(() => {
  conn = setupTestDb();
});

describe("daemon tick", () => {
  test("claims and completes a task", async () => {
    const task = await createTask(conn, {
      name: "Test task",
      description: "Do a thing",
    });

    await tick("/tmp/test-project", conn, {
      anthropic_api_key: "test-key",
      model: "claude-opus-4-20250514",
      chunker_model: "claude-haiku-4-20250514",
      tick_interval_seconds: 300,
      max_tick_duration_seconds: 120,
  max_turns: 0,
      system_prompt_override: "",
    });

    // Task should be completed
    const updated = await getTask(conn, task.id);
    expect(updated?.status).toBe("complete");
  });

  test("creates a thread with interactions", async () => {
    await createTask(conn, {
      name: "Test task",
      description: "Do a thing",
    });

    await tick("/tmp/test-project", conn, {
      anthropic_api_key: "test-key",
      model: "claude-opus-4-20250514",
      chunker_model: "claude-haiku-4-20250514",
      tick_interval_seconds: 300,
      max_tick_duration_seconds: 120,
  max_turns: 0,
      system_prompt_override: "",
    });

    // Should have created a thread
    const threads = await listThreads(conn, { type: "daemon_tick" });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.ended_at).not.toBeNull();

    // Thread should have interactions
    const threadId = threads[0]?.id;
    expect(threadId).toBeDefined();
    const threadData = await getThread(conn, threadId as string);
    expect(threadData?.interactions.length).toBeGreaterThan(0);

    // Should have: user message, assistant message, tool_use, tool_result, status_change
    const kinds = threadData?.interactions.map((i) => i.kind);
    expect(kinds).toContain("message");
    expect(kinds).toContain("tool_use");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("status_change");
  });

  test("does nothing when no tasks available", async () => {
    await tick("/tmp/test-project", conn, {
      anthropic_api_key: "test-key",
      model: "claude-opus-4-20250514",
      chunker_model: "claude-haiku-4-20250514",
      tick_interval_seconds: 300,
      max_tick_duration_seconds: 120,
  max_turns: 0,
      system_prompt_override: "",
    });

    // No threads created
    const threads = await listThreads(conn);
    expect(threads).toHaveLength(0);
  });

  test("marks task as failed when LLM throws an error", async () => {
    // Override mock to throw
    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: async () => {
            throw new Error("API rate limit exceeded");
          },
        };
      },
    }));

    const { tick: tickFresh } = await import("../../src/daemon/tick.ts");

    const task = await createTask(conn, {
      name: "Will fail",
      description: "LLM will error",
    });

    await tickFresh("/tmp/test-project", conn, {
      anthropic_api_key: "test-key",
      model: "claude-opus-4-20250514",
      chunker_model: "claude-haiku-4-20250514",
      tick_interval_seconds: 300,
      max_tick_duration_seconds: 120,
  max_turns: 0,
      system_prompt_override: "",
    });

    const updated = await getTask(conn, task.id);
    expect(updated?.status).toBe("failed");

    // Thread should still be created and ended
    const threads = await listThreads(conn, { type: "daemon_tick" });
    expect(threads.length).toBeGreaterThanOrEqual(1);
    const thread = threads.find((t) => t.task_id === task.id);
    expect(thread?.ended_at).not.toBeNull();

    // Restore original mock
    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: async () => ({
            content: [
              { type: "text", text: "I'll complete this task." },
              {
                type: "tool_use",
                id: "tool_1",
                name: "complete_task",
                input: { summary: "Task done successfully" },
              },
            ],
            stop_reason: "tool_use",
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        };
      },
    }));
  });

  test("processes highest priority task first", async () => {
    // Create low priority first, then high priority
    const lowTask = await createTask(conn, {
      name: "Low priority task",
      description: "Not urgent",
      priority: "low",
    });
    const highTask = await createTask(conn, {
      name: "High priority task",
      description: "Very urgent",
      priority: "high",
    });

    await tick("/tmp/test-project", conn, {
      anthropic_api_key: "test-key",
      model: "claude-opus-4-20250514",
      chunker_model: "claude-haiku-4-20250514",
      tick_interval_seconds: 300,
      max_tick_duration_seconds: 120,
  max_turns: 0,
      system_prompt_override: "",
    });

    // High priority task should be completed
    const updatedHigh = await getTask(conn, highTask.id);
    expect(updatedHigh?.status).toBe("complete");

    // Low priority task should still be pending
    const updatedLow = await getTask(conn, lowTask.id);
    expect(updatedLow?.status).toBe("pending");
  });
});
