import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamText } from "ai";
import { createFakeLanguageModel } from "../../src/llm/fake.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "both-fake-llm-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE;
});

async function writeFixture(turns: unknown[]): Promise<string> {
  const path = join(tmpDir, "fixture.json");
  await writeFile(path, JSON.stringify({ turns }));
  process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = path;
  return path;
}

describe("createFakeLanguageModel", () => {
  test("streams text-delta parts for plain-text turns", async () => {
    await writeFixture([{ text: "hello world", chunkSize: 5, delayMs: 0 }]);
    const model = createFakeLanguageModel();
    const result = streamText({
      model,
      messages: [{ role: "user", content: "hi" }],
    });

    let collected = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") collected += part.text;
    }
    expect(collected).toBe("hello world");
  });

  test("emits tool-call parts when toolCalls are present", async () => {
    await writeFixture([
      {
        text: "calling tool",
        toolCalls: [{ id: "tu_1", name: "noop", input: { x: 1 } }],
        delayMs: 0,
      },
    ]);
    const model = createFakeLanguageModel();
    const result = streamText({
      model,
      messages: [{ role: "user", content: "go" }],
    });

    const toolCalls: Array<{ id: string; name: string }> = [];
    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        toolCalls.push({ id: part.toolCallId, name: part.toolName });
      }
    }
    expect(toolCalls).toEqual([{ id: "tu_1", name: "noop" }]);
  });

  test("regex match selects a turn by user text", async () => {
    await writeFixture([
      { match: "weather", text: "it is sunny", delayMs: 0 },
      { text: "fallback", delayMs: 0 },
    ]);
    const model = createFakeLanguageModel();
    const result = streamText({
      model,
      messages: [{ role: "user", content: "what is the weather?" }],
    });
    let collected = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") collected += part.text;
    }
    expect(collected).toBe("it is sunny");
  });
});
