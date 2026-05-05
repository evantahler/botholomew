/**
 * createFakeAnthropicClient produces a deterministic stand-in for the
 * real Anthropic SDK, driven by a JSON fixture pointed at by
 * BOTHOLOMEW_FAKE_LLM_FIXTURE. Used by capture/demo tooling and end-to-end
 * test scenarios. Critical behaviors:
 *   - per-turn match: regex against the most recent user text
 *   - sequential fallback when no turn matches
 *   - text streaming (chunks emit "text" events; finalMessage settles)
 *   - tool_use emission: streamEvent content_block_start before the
 *     contentBlock event, then content_block_delta and stop, all so the
 *     consumer can stream-build assistant turns identically to the real SDK
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeAnthropicClient } from "../../src/worker/fake-llm.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "both-fake-llm-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE;
});

async function fixtureFile(turns: unknown[]): Promise<string> {
  const path = join(tmpDir, "fixture.json");
  await writeFile(path, JSON.stringify({ turns }));
  process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE = path;
  return path;
}

describe("createFakeAnthropicClient — messages.create", () => {
  test("returns the next sequential turn when nothing matches", async () => {
    await fixtureFile([{ text: "first reply" }, { text: "second reply" }]);
    const client = createFakeAnthropicClient();
    const r1 = await client.messages.create({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    } as never);
    const r2 = await client.messages.create({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    } as never);
    const t1 = r1.content[0] as { text: string };
    const t2 = r2.content[0] as { text: string };
    expect(t1.text).toBe("first reply");
    expect(t2.text).toBe("second reply");
  });

  test("selects the matching turn whose regex hits the last user message", async () => {
    await fixtureFile([
      { match: "kubernetes", text: "k8s reply" },
      { match: "paternity", text: "leave reply" },
    ]);
    const client = createFakeAnthropicClient();
    const r = await client.messages.create({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "tell me about paternity leave" }],
    } as never);
    const t = r.content[0] as { text: string };
    expect(t.text).toBe("leave reply");
  });

  test("emits tool_use blocks in the response when the fixture turn declares them", async () => {
    await fixtureFile([
      {
        text: "ack",
        toolCalls: [
          { id: "tool_1", name: "complete_task", input: { summary: "done" } },
        ],
      },
    ]);
    const client = createFakeAnthropicClient();
    const r = await client.messages.create({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "go" }],
    } as never);
    expect(r.stop_reason).toBe("tool_use");
    const tu = r.content.find((b) => b.type === "tool_use") as
      | { name: string; input: { summary: string } }
      | undefined;
    expect(tu?.name).toBe("complete_task");
    expect(tu?.input.summary).toBe("done");
  });

  test("title-generator system prompts get a fixed Chat session reply (don't consume fixture turns)", async () => {
    await fixtureFile([{ text: "main turn" }]);
    const client = createFakeAnthropicClient();
    const titleReply = await client.messages.create({
      model: "x",
      max_tokens: 100,
      system: "You are a title generator.",
      messages: [{ role: "user", content: "anything" }],
    } as never);
    const main = await client.messages.create({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    } as never);
    const titleText = titleReply.content[0] as { text: string };
    const mainText = main.content[0] as { text: string };
    expect(titleText.text).toBe("Chat session");
    // The main fixture turn is still available for the next non-title call.
    expect(mainText.text).toBe("main turn");
  });
});

describe("createFakeAnthropicClient — messages.stream", () => {
  test("streams text chunks via the 'text' event and resolves finalMessage", async () => {
    await fixtureFile([{ text: "hello world", chunkSize: 3, delayMs: 0 }]);
    const client = createFakeAnthropicClient();
    const stream = client.messages.stream({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "go" }],
    } as never);

    const chunks: string[] = [];
    stream.on("text", (text: string) => chunks.push(text));
    const final = await stream.finalMessage();

    expect(chunks.join("")).toBe("hello world");
    expect(chunks.length).toBeGreaterThan(1);
    const t = final.content[0] as { text: string };
    expect(t.text).toBe("hello world");
  });

  test("emits content_block_start streamEvents before tool_use contentBlock", async () => {
    await fixtureFile([
      {
        text: "",
        toolCalls: [
          { id: "tool_1", name: "complete_task", input: { summary: "ok" } },
        ],
      },
    ]);
    const client = createFakeAnthropicClient();
    const stream = client.messages.stream({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "go" }],
    } as never);

    const events: string[] = [];
    stream.on("streamEvent", (ev: { type: string }) => events.push(ev.type));
    await stream.finalMessage();
    expect(events).toContain("content_block_start");
  });

  test("repeats the last turn when fixture is exhausted (so the loop doesn't spin)", async () => {
    await fixtureFile([{ text: "only-one" }]);
    const client = createFakeAnthropicClient();
    const r1 = await client.messages.create({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "first" }],
    } as never);
    const r2 = await client.messages.create({
      model: "x",
      max_tokens: 100,
      messages: [{ role: "user", content: "second" }],
    } as never);
    const t1 = r1.content[0] as { text: string };
    const t2 = r2.content[0] as { text: string };
    expect(t1.text).toBe("only-one");
    expect(t2.text).toBe("only-one");
  });
});
