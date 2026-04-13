import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { createSchedule, getSchedule } from "../../src/db/schedules.ts";
import { listTasks } from "../../src/db/tasks.ts";
import { setupTestDb } from "../helpers.ts";

let mockResponse: Record<string, unknown> = {};

// Mock the Anthropic SDK before importing schedules module
mock.module("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: async () => ({
          content: [{ type: "text", text: JSON.stringify(mockResponse) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 50, output_tokens: 50 },
        }),
      };
    },
  };
});

const { evaluateSchedule, processSchedules } = await import(
  "../../src/daemon/schedules.ts"
);

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
  mockResponse = {};
});

describe("evaluateSchedule", () => {
  test("returns isDue with tasks when schedule is due", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "Last run was over 24 hours ago",
      tasks: [
        { name: "Check email", description: "Read inbox", priority: "medium" },
      ],
    };

    const schedule = await createSchedule(conn, {
      name: "Morning email",
      frequency: "every morning",
    });

    const result = await evaluateSchedule(testConfig, schedule);
    expect(result.isDue).toBe(true);
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0]?.name).toBe("Check email");
  });

  test("returns not due when schedule is not due", async () => {
    mockResponse = {
      isDue: false,
      reasoning: "Last run was 1 hour ago, too soon",
      tasks: [],
    };

    const schedule = await createSchedule(conn, {
      name: "Hourly check",
      frequency: "every 4 hours",
    });

    const result = await evaluateSchedule(testConfig, schedule);
    expect(result.isDue).toBe(false);
    expect(result.tasksToCreate).toHaveLength(0);
  });

  test("handles malformed LLM response gracefully", async () => {
    // Override mock to return invalid JSON
    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: async () => ({
            content: [{ type: "text", text: "not valid json {{{" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 50 },
          }),
        };
      },
    }));

    // Re-import to get the new mock
    const { evaluateSchedule: evalFresh } = await import(
      "../../src/daemon/schedules.ts"
    );

    const schedule = await createSchedule(conn, {
      name: "Test",
      frequency: "daily",
    });

    const result = await evalFresh(testConfig, schedule);
    expect(result.isDue).toBe(false);
    expect(result.reasoning).toContain("failed");

    // Restore original mock
    mock.module("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = {
          create: async () => ({
            content: [{ type: "text", text: JSON.stringify(mockResponse) }],
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 50 },
          }),
        };
      },
    }));
  });

  test("handles tasks with depends_on", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "Due now",
      tasks: [
        { name: "Step 1", description: "First", priority: "high" },
        {
          name: "Step 2",
          description: "Second",
          priority: "medium",
          depends_on: [0],
        },
      ],
    };

    const schedule = await createSchedule(conn, {
      name: "Multi-step",
      frequency: "daily",
    });

    const result = await evaluateSchedule(testConfig, schedule);
    expect(result.tasksToCreate).toHaveLength(2);
    expect(result.tasksToCreate[1]?.depends_on).toEqual([0]);
  });
});

describe("processSchedules", () => {
  test("creates tasks for due schedules", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "Due now",
      tasks: [
        { name: "Read email", description: "Check inbox", priority: "medium" },
      ],
    };

    await createSchedule(conn, {
      name: "Morning email",
      frequency: "every morning",
    });

    await processSchedules(conn, testConfig);

    const tasks = await listTasks(conn);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("Read email");
  });

  test("updates last_run_at for due schedules", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "Due",
      tasks: [{ name: "Task", description: "", priority: "low" }],
    };

    const schedule = await createSchedule(conn, {
      name: "Test",
      frequency: "daily",
    });

    await processSchedules(conn, testConfig);

    const updated = await getSchedule(conn, schedule.id);
    expect(updated?.last_run_at).not.toBeNull();
  });

  test("does not create tasks for not-due schedules", async () => {
    mockResponse = {
      isDue: false,
      reasoning: "Not due yet",
      tasks: [],
    };

    await createSchedule(conn, {
      name: "Future",
      frequency: "weekly",
    });

    await processSchedules(conn, testConfig);

    const tasks = await listTasks(conn);
    expect(tasks).toHaveLength(0);
  });

  test("skips disabled schedules", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "Due",
      tasks: [{ name: "Task", description: "", priority: "low" }],
    };

    const schedule = await createSchedule(conn, {
      name: "Disabled",
      frequency: "daily",
    });

    const { updateSchedule } = await import("../../src/db/schedules.ts");
    await updateSchedule(conn, schedule.id, { enabled: false });

    await processSchedules(conn, testConfig);

    const tasks = await listTasks(conn);
    expect(tasks).toHaveLength(0);
  });

  test("wires depends_on to blocked_by", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "Due",
      tasks: [
        { name: "Step 1", description: "First", priority: "high" },
        {
          name: "Step 2",
          description: "Second",
          priority: "medium",
          depends_on: [0],
        },
      ],
    };

    await createSchedule(conn, {
      name: "Multi-step",
      frequency: "daily",
    });

    await processSchedules(conn, testConfig);

    const tasks = await listTasks(conn);
    expect(tasks).toHaveLength(2);

    // Step 2 should be blocked by Step 1
    const step1 = tasks.find((t) => t.name === "Step 1");
    const step2 = tasks.find((t) => t.name === "Step 2");
    expect(step1).toBeDefined();
    expect(step2).toBeDefined();
    expect(step2?.blocked_by).toContain(step1?.id);
  });

  test("does nothing with no enabled schedules", async () => {
    // No schedules at all — should return immediately
    await processSchedules(conn, testConfig);

    const tasks = await listTasks(conn);
    expect(tasks).toHaveLength(0);
  });
});
