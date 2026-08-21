import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveSince, runDream } from "../../src/commands/dream.ts";
import { createFakeLanguageModel } from "../../src/llm/fake.ts";
import { sharedWithMem } from "../../src/mem/client.ts";
import {
  createThread,
  getThread,
  logInteraction,
} from "../../src/threads/store.ts";
import { setupTestMembot } from "../helpers.ts";

describe("resolveSince", () => {
  const now = new Date("2026-06-07T12:00:00.000Z");

  test("defaults to now - lookbackHours when omitted", () => {
    const since = resolveSince(undefined, 24, now);
    expect(since.toISOString()).toBe("2026-06-06T12:00:00.000Z");
  });

  test("parses relative hours and days", () => {
    expect(resolveSince("6h", 24, now).toISOString()).toBe(
      "2026-06-07T06:00:00.000Z",
    );
    expect(resolveSince("7d", 24, now).toISOString()).toBe(
      "2026-05-31T12:00:00.000Z",
    );
  });

  test("parses an ISO date", () => {
    expect(resolveSince("2026-06-01", 24, now).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  test("throws on an unparseable value", () => {
    expect(() => resolveSince("not-a-date", 24, now)).toThrow(
      /Could not parse/,
    );
  });
});

describe("runDream", () => {
  let mem: Awaited<ReturnType<typeof setupTestMembot>>["mem"];
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ mem, projectDir, cleanup } = await setupTestMembot());
    await mkdir(join(projectDir, "config"), { recursive: true });
    await writeFile(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: { default: { provider: "anthropic", api_key: "test-key" } },
        membot_scope: "project",
        mcpx_scope: "project",
      }),
    );
  });

  afterEach(async () => {
    delete process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE;
    await cleanup();
  });

  async function writeFixture(turns: unknown[]): Promise<void> {
    const path = join(projectDir, "fixture.json");
    await writeFile(path, JSON.stringify({ turns }));
    process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = path;
  }

  test("creates a Dream thread, reviews threads via tools, and ends it", async () => {
    const prior = await createThread(
      projectDir,
      "chat_session",
      undefined,
      "x",
    );
    await logInteraction(projectDir, prior, {
      role: "user",
      kind: "message",
      content: "we decided to use DuckDB for storage",
    });

    await writeFixture([
      {
        match: "dream",
        text: "Let me review recent threads.",
        toolCalls: [{ name: "list_threads", input: {} }],
        delayMs: 0,
      },
      { text: "Reflection complete — reviewed 1 thread.", delayMs: 0 },
    ]);

    const threadId = await runDream(projectDir, {
      _testModel: createFakeLanguageModel(),
      _testWithMem: sharedWithMem(mem),
    });

    const data = await getThread(projectDir, threadId);
    if (!data) throw new Error("dream thread missing");
    expect(data.thread.title).toMatch(/^Dream — /);
    expect(data.thread.ended_at).not.toBeNull();

    // Seed user message carries the reflection instructions + a window line.
    const seed = data.interactions.find((i) => i.role === "user");
    expect(seed?.content).toContain("search_threads");
    expect(seed?.content).toContain("Scope your recall");

    // The agent actually invoked a tool and got a result back.
    const toolResult = data.interactions.find((i) => i.role === "tool");
    expect(toolResult?.tool_name).toBe("list_threads");
  });

  test("--dry-run injects a propose-only directive into the prompt", async () => {
    await writeFixture([{ text: "Here is what I would change.", delayMs: 0 }]);

    const threadId = await runDream(projectDir, {
      dryRun: true,
      _testModel: createFakeLanguageModel(),
      _testWithMem: sharedWithMem(mem),
    });

    const data = await getThread(projectDir, threadId);
    const seed = data?.interactions.find((i) => i.role === "user");
    expect(seed?.content).toContain("DRY RUN");
  });
});
