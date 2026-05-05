import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { THREADS_DIR } from "../../src/constants.ts";
import {
  mockEmbed,
  mockEmbedSingle,
  silentLogger,
  TEST_CONFIG,
} from "../helpers.ts";

// Embedder + logger are safe to mock globally — they're already swapped out in
// other test files. We deliberately do NOT mock createLlmClient or
// getMaxInputTokens here (mock.module is global to the bun test runner and
// leaks across files); instead we inject a test client into runChatTurn.
mock.module("../../src/context/embedder.ts", () => ({
  embed: mockEmbed,
  embedSingle: mockEmbedSingle,
}));
mock.module("../../src/utils/logger.ts", () => silentLogger);

const { runChatTurn } = await import("../../src/chat/agent.ts");
const { createThread } = await import("../../src/threads/store.ts");

class FakeMessageStream extends EventEmitter {
  aborted = false;
  private _resolve: ((m: unknown) => void) | null = null;
  private _reject: ((e: unknown) => void) | null = null;
  private _final: Promise<unknown>;
  constructor() {
    super();
    this._final = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this._reject?.(new APIUserAbortError());
  }
  finalMessage(): Promise<unknown> {
    return this._final;
  }
  resolveFinal(msg: unknown): void {
    this._resolve?.(msg);
  }
}

function makeClient(streamFactory: () => FakeMessageStream) {
  let calls = 0;
  const client = {
    messages: {
      stream: () => {
        calls++;
        return streamFactory();
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal Anthropic stub for runChatTurn injection
  } as any;
  return { client, callCount: () => calls };
}

let dbPath: string;
let threadId: string;
let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "chat-steer-"));
  await mkdir(join(projectDir, THREADS_DIR), { recursive: true });
  dbPath = join(projectDir, "index.duckdb");
  threadId = await createThread(projectDir, "chat_session", undefined, "test");
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const noopCallbacks = {
  onToken: () => {},
  onToolStart: () => {},
  onToolEnd: () => {},
};

function makeSession() {
  return {
    dbPath,
    threadId,
    projectDir,
    config: TEST_CONFIG,
    messages: [] as MessageParam[],
    skills: new Map(),
    mcpxClient: null,
    cleanup: async () => {},
    activeStream: null,
    aborted: false,
    // biome-ignore lint/suspicious/noExplicitAny: test stand-in for ChatSession
  } as any;
}

describe("runChatTurn — steering / abort", () => {
  test("abort during streaming persists partial assistantText and exits the loop", async () => {
    const session = makeSession();
    const messages: MessageParam[] = [{ role: "user", content: "hi" }];

    const { client, callCount } = makeClient(() => {
      const s = new FakeMessageStream();
      queueMicrotask(() => {
        s.emit("text", "Hello ");
        s.emit("text", "world");
        s.abort();
      });
      return s;
    });

    await runChatTurn({
      messages,
      projectDir,
      config: TEST_CONFIG,
      dbPath,
      threadId,
      mcpxClient: null,
      callbacks: noopCallbacks,
      session,
      _testClient: client,
      _testMaxInputTokens: 100_000,
    });

    expect(callCount()).toBe(1);
    expect(messages.length).toBe(2);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "Hello world",
    });
    expect(session.activeStream).toBeNull();
  });

  test("session.aborted set before runChatTurn short-circuits without calling stream", async () => {
    const session = makeSession();
    session.aborted = true;
    const messages: MessageParam[] = [{ role: "user", content: "hi" }];

    const { client, callCount } = makeClient(() => {
      throw new Error("should not be called");
    });

    await runChatTurn({
      messages,
      projectDir,
      config: TEST_CONFIG,
      dbPath,
      threadId,
      mcpxClient: null,
      callbacks: noopCallbacks,
      session,
      _testClient: client,
      _testMaxInputTokens: 100_000,
    });

    expect(callCount()).toBe(0);
    expect(messages.length).toBe(1);
  });

  test("takeInjections drains queued user messages between LLM turns", async () => {
    const session = makeSession();
    const messages: MessageParam[] = [{ role: "user", content: "first" }];
    const queued = ["second"];
    let observedMessagesAtStream: MessageParam[] | null = null;

    const { client } = makeClient(() => {
      const s = new FakeMessageStream();
      observedMessagesAtStream = [...messages];
      queueMicrotask(() => {
        s.emit("text", "ok");
        s.resolveFinal({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      });
      return s;
    });

    await runChatTurn({
      messages,
      projectDir,
      config: TEST_CONFIG,
      dbPath,
      threadId,
      mcpxClient: null,
      callbacks: {
        ...noopCallbacks,
        takeInjections: () => queued.splice(0),
      },
      session,
      _testClient: client,
      _testMaxInputTokens: 100_000,
    });

    expect(observedMessagesAtStream).not.toBeNull();
    expect(observedMessagesAtStream as MessageParam[] | null).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ]);
    expect(queued.length).toBe(0);
  });

  test("mid-stream abort with a pending tool_use does not append unmatched tool_use blocks", async () => {
    const session = makeSession();
    const messages: MessageParam[] = [{ role: "user", content: "do work" }];

    const { client } = makeClient(() => {
      const s = new FakeMessageStream();
      queueMicrotask(() => {
        s.emit("text", "starting");
        // Emit a content_block_start for a tool_use, but never the
        // matching contentBlock — abort fires while the tool_use is partial.
        s.emit("streamEvent", {
          type: "content_block_start",
          content_block: {
            type: "tool_use",
            id: "tool_partial",
            name: "list_tasks",
          },
        });
        s.abort();
      });
      return s;
    });

    await runChatTurn({
      messages,
      projectDir,
      config: TEST_CONFIG,
      dbPath,
      threadId,
      mcpxClient: null,
      callbacks: noopCallbacks,
      session,
      _testClient: client,
      _testMaxInputTokens: 100_000,
    });

    expect(messages.length).toBe(2);
    const appended = messages[1];
    expect(appended?.role).toBe("assistant");
    // Critical: the appended assistant content must be plain text, not an
    // array containing a partial tool_use block (which would break the next
    // turn with "tool_use without matching tool_result").
    expect(typeof appended?.content).toBe("string");
    expect(appended?.content).toBe("starting");
  });
});
