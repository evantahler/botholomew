/**
 * Chat session lifecycle: startChatSession initializes the project DB,
 * creates a chat_session thread CSV, and the session can be ended/cleared.
 * Anthropic SDK is mocked so init's createMcpxClient and chat startup
 * don't actually call out.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../../src/init/index.ts";
import { listThreads } from "../../src/threads/store.ts";
import { silentLogger } from "../helpers.ts";

mock.module("../../src/utils/logger.ts", () => silentLogger);

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({
        content: [
          { type: "text", text: '{"isDue":false,"reasoning":"","tasks":[]}' },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    };
  },
}));

const { startChatSession, endChatSession, clearChatSession } = await import(
  "../../src/chat/session.ts"
);

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-chat-session-"));
  await initProject(projectDir);
  // initProject seeds config without an api key set; chat insists on one.
  // Patch the config file to add a fake key.
  const configPath = join(projectDir, "config", "config.json");
  const cfg = JSON.parse(await Bun.file(configPath).text());
  cfg.anthropic_api_key = "test-key";
  await Bun.write(configPath, JSON.stringify(cfg, null, 2));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("startChatSession", () => {
  test("creates a session with a fresh chat_session thread", async () => {
    const session = await startChatSession(projectDir);
    try {
      expect(session.threadId).toBeTruthy();
      expect(session.projectDir).toBe(projectDir);
      expect(session.messages).toEqual([]);
      expect(session.activeStream).toBeNull();
      expect(session.aborted).toBe(false);

      const threads = await listThreads(projectDir, { type: "chat_session" });
      const ids = threads.map((t) => t.id);
      expect(ids).toContain(session.threadId);
    } finally {
      await endChatSession(session);
    }
  });

  test("refuses to start without an Anthropic API key", async () => {
    // Strip the api key we patched in.
    const configPath = join(projectDir, "config", "config.json");
    const cfg = JSON.parse(await Bun.file(configPath).text());
    cfg.anthropic_api_key = "";
    await Bun.write(configPath, JSON.stringify(cfg, null, 2));

    await expect(startChatSession(projectDir)).rejects.toThrow(/API key/i);
  });
});

describe("endChatSession", () => {
  test("marks the chat_session thread as ended", async () => {
    const session = await startChatSession(projectDir);
    await endChatSession(session);
    const threads = await listThreads(projectDir, { type: "chat_session" });
    const t = threads.find((x) => x.id === session.threadId);
    expect(t?.ended_at).not.toBeNull();
  });
});

describe("clearChatSession", () => {
  test("ends the current thread and starts a fresh one", async () => {
    const session = await startChatSession(projectDir);
    try {
      const before = session.threadId;
      session.messages.push({ role: "user", content: "leftover" });
      const { previousThreadId, newThreadId } = await clearChatSession(session);
      expect(previousThreadId).toBe(before);
      expect(newThreadId).not.toBe(before);
      expect(session.threadId).toBe(newThreadId);
      expect(session.messages).toEqual([]);
      expect(session.aborted).toBe(false);
    } finally {
      await endChatSession(session);
    }
  });
});
