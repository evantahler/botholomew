import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChatSystemPrompt, getChatTools } from "../../src/chat/agent.ts";
import { getPromptsDir } from "../../src/constants.ts";

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
