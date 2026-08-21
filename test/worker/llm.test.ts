import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sharedWithMem } from "../../src/mem/client.ts";
import type { Task } from "../../src/tasks/schema.ts";
import { createThread } from "../../src/threads/store.ts";
import { runAgentLoop } from "../../src/worker/llm.ts";
import { setupTestMembot, TEST_CONFIG, TEST_LLM } from "../helpers.ts";

// runAgentLoop reads the model via getLanguageModel, which returns the fake
// MockLanguageModelV3 whenever BOTHOLOMEW_FAKE_LLM=1. The fake replays the
// turns from BOTHOLOMEW_FAKE_LLM_FIXTURE.

let mem: Awaited<ReturnType<typeof setupTestMembot>>["mem"];
let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ mem, projectDir, cleanup } = await setupTestMembot());
  process.env.BOTHOLOMEW_FAKE_LLM = "1";
});

afterEach(async () => {
  delete process.env.BOTHOLOMEW_FAKE_LLM;
  delete process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE;
  await cleanup();
});

async function writeFixture(turns: unknown[]): Promise<void> {
  const path = join(projectDir, "fixture.json");
  await writeFile(path, JSON.stringify({ turns }));
  process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = path;
}

function makeTask(): Task {
  const now = new Date().toISOString();
  return {
    id: "task-test",
    name: "Test task",
    description: "Do a thing",
    priority: "medium",
    model: null,
    status: "in_progress",
    blocked_by: [],
    context_paths: [],
    output: null,
    waiting_reason: null,
    claimed_by: "worker-1",
    claimed_at: now,
    created_at: now,
    updated_at: now,
    mtimeMs: 0,
    body: "",
  };
}

async function run(): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const threadId = await createThread(
    projectDir,
    "worker_tick",
    "task-test",
    "Working: Test task",
  );
  return runAgentLoop({
    systemPrompt: "You are a test worker.",
    task: makeTask(),
    config: TEST_CONFIG,
    llm: TEST_LLM,
    withMem: sharedWithMem(mem),
    threadId,
    projectDir,
    workerId: "worker-1",
  });
}

describe("runAgentLoop implicit tick-end (issue #255)", () => {
  test("fails (not completes) when the agent never calls a terminal tool", async () => {
    // Both turns emit text but no tool calls: the first triggers the nudge,
    // the second still has no terminal call, so the loop must fail.
    await writeFixture([
      { text: "I pulled the data.", delayMs: 0 },
      { text: "Still thinking.", delayMs: 0 },
    ]);

    const result = await run();

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("terminal status tool");
  });

  test("nudge lets the agent recover to complete on the next turn", async () => {
    // First turn forgets the terminal call; after the nudge, the agent calls
    // complete_task — which must map to a legitimate complete.
    await writeFixture([
      { text: "Done with the work.", delayMs: 0 },
      {
        text: "Wrapping up.",
        toolCalls: [
          { name: "complete_task", input: { summary: "All finished" } },
        ],
        delayMs: 0,
      },
    ]);

    const result = await run();

    expect(result.status).toBe("complete");
    expect(result.reason).toBe("All finished");
  });

  test("nudge lets the agent recover by failing on a capability gap", async () => {
    await writeFixture([
      { text: "No tool can render a PNG here.", delayMs: 0 },
      {
        text: "Reporting the gap.",
        toolCalls: [
          {
            name: "fail_task",
            input: { reason: "No code/plotting tool available" },
          },
        ],
        delayMs: 0,
      },
    ]);

    const result = await run();

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("No code/plotting tool available");
  });
});
