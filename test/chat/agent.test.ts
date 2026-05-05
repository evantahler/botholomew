/**
 * Chat agent surface: getChatTools filters the registry to chat-allowed
 * tools, buildChatSystemPrompt assembles the prompt with prompts/ files
 * and optional MCP guidance.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChatSystemPrompt, getChatTools } from "../../src/chat/agent.ts";
import { getPromptsDir } from "../../src/constants.ts";
import { STYLE_RULES } from "../../src/worker/prompt.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-chat-agent-"));
  await mkdir(getPromptsDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function writePrompt(name: string, body: string): Promise<void> {
  await writeFile(join(getPromptsDir(projectDir), name), body);
}

describe("getChatTools", () => {
  test("returns a non-empty list of tools in Anthropic SDK format", () => {
    const tools = getChatTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema).toBeDefined();
      expect(t.input_schema.type).toBe("object");
    }
  });

  test("includes the chat-allowed tools and excludes terminal worker tools", () => {
    const names = new Set(getChatTools().map((t) => t.name));
    // Whitelist sample
    expect(names.has("create_task")).toBe(true);
    expect(names.has("list_tasks")).toBe(true);
    expect(names.has("view_thread")).toBe(true);
    expect(names.has("search_threads")).toBe(true);
    expect(names.has("context_read")).toBe(true);
    expect(names.has("search")).toBe(true);
    // Terminal worker-only tools must not leak in
    expect(names.has("complete_task")).toBe(false);
    expect(names.has("fail_task")).toBe(false);
    expect(names.has("wait_task")).toBe(false);
    // Bulk-destructive file tools are out
    expect(names.has("context_delete")).toBe(false);
    expect(names.has("context_copy")).toBe(false);
    expect(names.has("context_move")).toBe(false);
  });
});

describe("buildChatSystemPrompt", () => {
  test("includes the meta header and project directory", async () => {
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).toMatch(/# Botholomew v\d+\.\d+\.\d+/);
    expect(prompt).toContain(projectDir);
  });

  test("includes the chat-flavored Instructions block", async () => {
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).toContain("## Instructions");
    // Chat agent's role line.
    expect(prompt).toContain("interactive chat interface");
  });

  test("Style block lands after Instructions", async () => {
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).toContain(STYLE_RULES);
    expect(prompt.indexOf("## Instructions")).toBeLessThan(
      prompt.indexOf(STYLE_RULES),
    );
  });

  test("includes always-loaded prompt files verbatim", async () => {
    await writePrompt(
      "soul.md",
      "---\nloading: always\n---\n\nI am the wise owl.\n",
    );
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).toContain("I am the wise owl.");
  });

  test("includes contextual files when keywordSource matches", async () => {
    await writePrompt(
      "deploy.md",
      "---\nloading: contextual\n---\n\nDeployment runbook.\n",
    );
    const prompt = await buildChatSystemPrompt(projectDir, {
      keywordSource: "I want to talk about deployment today",
    });
    expect(prompt).toContain("Deployment runbook.");
  });

  test("excludes contextual files when keywordSource doesn't overlap", async () => {
    await writePrompt(
      "deploy.md",
      "---\nloading: contextual\n---\n\nDeployment runbook.\n",
    );
    const prompt = await buildChatSystemPrompt(projectDir, {
      keywordSource: "completely unrelated topic about cooking",
    });
    expect(prompt).not.toContain("Deployment runbook.");
  });

  test("excludes contextual files when no keywordSource is given", async () => {
    await writePrompt(
      "deploy.md",
      "---\nloading: contextual\n---\n\nDeployment runbook.\n",
    );
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).not.toContain("Deployment runbook.");
  });

  test("includes MCP guidance when hasMcpTools is true", async () => {
    const prompt = await buildChatSystemPrompt(projectDir, {
      hasMcpTools: true,
    });
    expect(prompt).toContain("## External Tools (MCP)");
    expect(prompt).toContain("Local context first");
    expect(prompt).toContain("mcp_info");
  });

  test("omits MCP guidance when hasMcpTools is absent", async () => {
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).not.toContain("## External Tools (MCP)");
  });

  test("Style block lands after the MCP block when both are present", async () => {
    const prompt = await buildChatSystemPrompt(projectDir, {
      hasMcpTools: true,
    });
    const mcpIdx = prompt.indexOf("## External Tools (MCP)");
    const styleIdx = prompt.indexOf(STYLE_RULES);
    expect(mcpIdx).toBeGreaterThan(0);
    expect(styleIdx).toBeGreaterThan(mcpIdx);
  });
});
