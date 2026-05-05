/**
 * Worker schedule processing: evaluateSchedule asks an LLM if a schedule
 * is due and which tasks to fan out; processSchedules applies the
 * lockfile-based claim, calls the evaluator, and creates tasks (with
 * blocked_by wiring) on disk. Anthropic SDK is module-mocked.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import {
  getSchedulesDir,
  getSchedulesLockDir,
  getTasksDir,
  getTasksLockDir,
} from "../../src/constants.ts";
import { createSchedule, getSchedule } from "../../src/schedules/store.ts";
import { listTasks } from "../../src/tasks/store.ts";

// Mutable response shape so each test can drive the mock.
let mockResponse: Record<string, unknown> = {};
// When set, the next mock call returns this raw text instead of JSON.stringify(mockResponse).
let mockRawText: string | null = null;

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({
        content: [
          {
            type: "text",
            text: mockRawText ?? JSON.stringify(mockResponse),
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 50, output_tokens: 50 },
      }),
    };
  },
}));

const { evaluateSchedule, processSchedules } = await import(
  "../../src/worker/schedules.ts"
);

const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
} as Required<typeof DEFAULT_CONFIG>;

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-worker-schedules-"));
  await mkdir(getSchedulesDir(projectDir), { recursive: true });
  await mkdir(getSchedulesLockDir(projectDir), { recursive: true });
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
  mockResponse = {};
  mockRawText = null;
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("evaluateSchedule", () => {
  test("returns isDue with parsed tasks when the LLM says due", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "Last run was 24 hours ago",
      tasks: [
        {
          name: "Check email",
          description: "Read inbox",
          priority: "medium",
        },
      ],
    };
    const s = await createSchedule(projectDir, {
      name: "Morning email",
      frequency: "every morning",
    });
    const r = await evaluateSchedule(TEST_CONFIG, s);
    expect(r.isDue).toBe(true);
    expect(r.tasksToCreate).toHaveLength(1);
    expect(r.tasksToCreate[0]?.name).toBe("Check email");
  });

  test("returns not due when LLM says not due", async () => {
    mockResponse = { isDue: false, reasoning: "too soon", tasks: [] };
    const s = await createSchedule(projectDir, {
      name: "Hourly",
      frequency: "every 4 hours",
    });
    const r = await evaluateSchedule(TEST_CONFIG, s);
    expect(r.isDue).toBe(false);
    expect(r.tasksToCreate).toHaveLength(0);
  });

  test("falls back to not-due on malformed JSON", async () => {
    mockRawText = "not valid json {{{";
    const s = await createSchedule(projectDir, {
      name: "Test",
      frequency: "daily",
    });
    const r = await evaluateSchedule(TEST_CONFIG, s);
    expect(r.isDue).toBe(false);
    expect(r.reasoning).toContain("failed");
  });

  test("strips ```json fences before parsing", async () => {
    mockRawText = `\`\`\`json\n${JSON.stringify({
      isDue: true,
      reasoning: "Due now",
      tasks: [
        {
          name: "Fenced task",
          description: "from code block",
          priority: "low",
        },
      ],
    })}\n\`\`\``;
    const s = await createSchedule(projectDir, {
      name: "Fenced",
      frequency: "daily",
    });
    const r = await evaluateSchedule(TEST_CONFIG, s);
    expect(r.isDue).toBe(true);
    expect(r.tasksToCreate[0]?.name).toBe("Fenced task");
  });

  test("forwards depends_on indices", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "due",
      tasks: [
        { name: "Step 1", description: "first", priority: "high" },
        {
          name: "Step 2",
          description: "second",
          priority: "medium",
          depends_on: [0],
        },
      ],
    };
    const s = await createSchedule(projectDir, {
      name: "Multi",
      frequency: "daily",
    });
    const r = await evaluateSchedule(TEST_CONFIG, s);
    expect(r.tasksToCreate).toHaveLength(2);
    expect(r.tasksToCreate[1]?.depends_on).toEqual([0]);
  });
});

describe("processSchedules", () => {
  test("creates tasks for due schedules", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "due",
      tasks: [
        { name: "Read email", description: "check inbox", priority: "medium" },
      ],
    };
    await createSchedule(projectDir, {
      name: "Morning",
      frequency: "every morning",
    });
    await processSchedules(projectDir, TEST_CONFIG, "worker-A");
    const tasks = await listTasks(projectDir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("Read email");
  });

  test("updates last_run_at after firing a due schedule", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "due",
      tasks: [{ name: "T", description: "", priority: "low" }],
    };
    const s = await createSchedule(projectDir, {
      name: "Test",
      frequency: "daily",
    });
    expect(s.last_run_at).toBeNull();
    await processSchedules(projectDir, TEST_CONFIG, "worker-A");
    const after = await getSchedule(projectDir, s.id);
    expect(after?.last_run_at).not.toBeNull();
  });

  test("skips not-due schedules without creating tasks", async () => {
    mockResponse = { isDue: false, reasoning: "too soon", tasks: [] };
    await createSchedule(projectDir, {
      name: "Future",
      frequency: "weekly",
    });
    await processSchedules(projectDir, TEST_CONFIG, "worker-A");
    expect(await listTasks(projectDir)).toHaveLength(0);
  });

  test("skips disabled schedules entirely", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "due",
      tasks: [{ name: "X", description: "", priority: "low" }],
    };
    await createSchedule(projectDir, {
      name: "Off",
      frequency: "daily",
      enabled: false,
    });
    await processSchedules(projectDir, TEST_CONFIG, "worker-A");
    expect(await listTasks(projectDir)).toHaveLength(0);
  });

  test("wires depends_on indices into blocked_by ids on disk", async () => {
    mockResponse = {
      isDue: true,
      reasoning: "due",
      tasks: [
        { name: "First", description: "", priority: "medium" },
        {
          name: "Second",
          description: "",
          priority: "medium",
          depends_on: [0],
        },
      ],
    };
    await createSchedule(projectDir, {
      name: "Chain",
      frequency: "daily",
    });
    await processSchedules(projectDir, TEST_CONFIG, "worker-A");
    const tasks = await listTasks(projectDir);
    const first = tasks.find((t) => t.name === "First");
    const second = tasks.find((t) => t.name === "Second");
    expect(first).toBeDefined();
    expect(second?.blocked_by).toEqual([first?.id ?? ""]);
  });

  test("no-ops when there are no enabled schedules", async () => {
    await processSchedules(projectDir, TEST_CONFIG, "worker-A");
    expect(await listTasks(projectDir)).toHaveLength(0);
  });
});
