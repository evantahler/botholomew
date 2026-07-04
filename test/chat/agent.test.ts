import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChatSystemPrompt,
  getChatTools,
  runChatTurn,
} from "../../src/chat/agent.ts";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getPromptsDir } from "../../src/constants.ts";
import { createFakeLanguageModel } from "../../src/llm/fake.ts";
import { sharedWithMem } from "../../src/mem/client.ts";
import { createThread } from "../../src/threads/store.ts";
import { setupTestMembot } from "../helpers.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-chat-"));
  await mkdir(getPromptsDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("chat agent tooling", () => {
  test("exposes the JSON-reduction tools (pipe + query)", () => {
    const tools = getChatTools();
    expect(tools).toHaveProperty("membot_pipe");
    expect(tools).toHaveProperty("membot_query");
  });

  test("system prompt teaches the pipe -> query pattern", async () => {
    const prompt = await buildChatSystemPrompt(projectDir, {
      hasMcpTools: true,
    });
    expect(prompt).toContain("## Large JSON results");
    expect(prompt).toContain("membot_pipe");
    expect(prompt).toContain("membot_query");
  });
});

describe("runChatTurn streaming", () => {
  let mem: Awaited<ReturnType<typeof setupTestMembot>>["mem"];
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ mem, projectDir: dir, cleanup } = await setupTestMembot());
    await mkdir(getPromptsDir(dir), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE;
    await cleanup();
  });

  test("awaits a promise-returning onToken before processing the next delta", async () => {
    // Fixture emits three text deltas and stops (no tool calls → single turn).
    const fixture = join(dir, "fixture.json");
    await writeFile(
      fixture,
      JSON.stringify({ turns: [{ chunks: ["a", "b", "c"], delayMs: 0 }] }),
    );
    process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = fixture;

    const threadId = await createThread(dir, "chat_session", undefined, "t");

    // Each onToken records the token synchronously, then resolves on a
    // macrotask. If the stream loop awaits the returned promise, tokens and
    // their resolutions strictly interleave (a, resolved:a, b, ...). If it
    // does NOT await, all tokens arrive before any resolution.
    const order: string[] = [];
    await runChatTurn({
      messages: [{ role: "user", content: "hi" }],
      projectDir: dir,
      config: { ...DEFAULT_CONFIG, max_turns: 1 },
      threadId,
      mcpxClient: null,
      _testModel: createFakeLanguageModel(),
      _testMaxInputTokens: 100_000,
      _testWithMem: sharedWithMem(mem),
      callbacks: {
        onToken: (token) => {
          order.push(token);
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              order.push(`resolved:${token}`);
              resolve();
            }, 0);
          });
        },
        onToolStart: () => {},
        onToolEnd: () => {},
      },
    });

    expect(order).toEqual([
      "a",
      "resolved:a",
      "b",
      "resolved:b",
      "c",
      "resolved:c",
    ]);
  });
});
