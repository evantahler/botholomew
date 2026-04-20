import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workDir: string;
const ORIGINAL_ENV = { ...process.env };

function writeFixture(name: string, body: unknown): string {
  const path = join(workDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fake-llm-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  process.env = { ...ORIGINAL_ENV };
});

describe("createFakeAnthropicClient", () => {
  test("streams text chunks from an auto-chunked fixture turn", async () => {
    process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = writeFixture("streaming", {
      turns: [{ text: "hello there friend", chunkSize: 4, delayMs: 0 }],
    });

    // Re-import so the module re-loads the fixture for this test.
    delete require.cache?.[require.resolve("../../src/worker/fake-llm.ts")];
    const { createFakeAnthropicClient } = await import(
      `../../src/worker/fake-llm.ts?cachebust=${Date.now()}`
    );
    const client = createFakeAnthropicClient();

    const stream = client.messages.stream({
      messages: [{ role: "user", content: "anything" }],
    });

    const received: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: EventEmitter surface
    (stream as any).on("text", (t: string) => received.push(t));
    const final = await stream.finalMessage();

    expect(received.join("")).toBe("hello there friend");
    expect(final.content).toHaveLength(1);
    expect(final.content[0]).toMatchObject({
      type: "text",
      text: "hello there friend",
    });
    expect(final.stop_reason).toBe("end_turn");
  });

  test("selects the turn whose match regex fits the last user message", async () => {
    process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = writeFixture("matching", {
      turns: [
        { match: "weather", text: "sunny", delayMs: 0 },
        { match: "schedule", text: "busy", delayMs: 0 },
      ],
    });

    const { createFakeAnthropicClient } = await import(
      `../../src/worker/fake-llm.ts?cachebust=${Date.now()}`
    );
    const client = createFakeAnthropicClient();

    const reply = await client.messages.create({
      messages: [{ role: "user", content: "what's my schedule?" }],
    });

    expect((reply.content[0] as { text: string }).text).toBe("busy");
  });

  test("emits contentBlock events for fixture tool calls", async () => {
    process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = writeFixture("tools", {
      turns: [
        {
          text: "",
          delayMs: 0,
          toolCalls: [{ name: "list_tasks", input: { limit: 5 } }],
        },
      ],
    });

    const { createFakeAnthropicClient } = await import(
      `../../src/worker/fake-llm.ts?cachebust=${Date.now()}`
    );
    const client = createFakeAnthropicClient();

    const stream = client.messages.stream({
      messages: [{ role: "user", content: "go" }],
    });

    const blocks: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: EventEmitter surface
    (stream as any).on("contentBlock", (b: unknown) => blocks.push(b));
    const final = await stream.finalMessage();

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "tool_use", name: "list_tasks" });
    expect(final.stop_reason).toBe("tool_use");
  });
});
