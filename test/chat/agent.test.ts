import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeContextFile } from "../../src/utils/frontmatter.ts";
import { mockEmbed, mockEmbedSingle, silentLogger } from "../helpers.ts";

// Mock the embedder to avoid loading the real model
mock.module("../../src/context/embedder.ts", () => ({
  embed: mockEmbed,
  embedSingle: mockEmbedSingle,
}));

// Mock the logger to suppress output
mock.module("../../src/utils/logger.ts", () => silentLogger);

const { buildChatSystemPrompt, getChatTools } = await import(
  "../../src/chat/agent.ts"
);

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "botholomew-chat-test-"));
  await mkdir(join(projectDir, ".botholomew"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("getChatTools", () => {
  test("returns only chat-allowed tools", () => {
    const tools = getChatTools();
    const names = tools.map((t) => t.name);

    // Should include chat tools
    expect(names).toContain("create_task");
    expect(names).toContain("list_tasks");
    expect(names).toContain("view_task");
    expect(names).toContain("list_threads");
    expect(names).toContain("view_thread");
    expect(names).toContain("context_search");
    expect(names).toContain("context_info");
    expect(names).toContain("context_refresh");
    expect(names).toContain("context_tree");
    expect(names).toContain("update_beliefs");
    expect(names).toContain("update_goals");
    expect(names).toContain("list_schedules");
    expect(names).toContain("create_schedule");

    // Should NOT include daemon terminal tools
    expect(names).not.toContain("complete_task");
    expect(names).not.toContain("fail_task");
    expect(names).not.toContain("wait_task");

    // Should NOT include destructive file tools
    expect(names).not.toContain("context_write");
    expect(names).not.toContain("context_delete");
    expect(names).not.toContain("context_edit");
  });

  test("returns valid Anthropic tool format", () => {
    const tools = getChatTools();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeTruthy();
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

describe("buildChatSystemPrompt", () => {
  test("includes chat-specific instructions", async () => {
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).toContain("Botholomew");
    expect(prompt).toContain("interactive chat interface");
    expect(prompt).toContain("create_task");
    expect(prompt).not.toContain("You are the Botholomew daemon");
  });

  test("includes meta header", async () => {
    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).toContain("Current time:");
    expect(prompt).toContain(projectDir);
  });

  test("includes always-loaded context files", async () => {
    const content = serializeContextFile(
      { loading: "always", "agent-modification": false },
      "I am the soul of the project.",
    );
    await Bun.write(join(projectDir, ".botholomew", "soul.md"), content);

    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).toContain("## soul.md");
    expect(prompt).toContain("I am the soul of the project.");
  });

  test("includes contextual files when keywordSource matches", async () => {
    const content = serializeContextFile(
      { loading: "contextual", "agent-modification": false },
      "Our invoicing system uses Stripe for billing.",
    );
    await Bun.write(join(projectDir, ".botholomew", "invoicing.md"), content);

    const prompt = await buildChatSystemPrompt(projectDir, {
      keywordSource: "what is our invoicing setup?",
    });
    expect(prompt).toContain("invoicing.md (contextual)");
    expect(prompt).toContain("Our invoicing system uses Stripe for billing.");
  });

  test("excludes contextual files when keywordSource does not match", async () => {
    const content = serializeContextFile(
      { loading: "contextual", "agent-modification": false },
      "Our invoicing system uses Stripe for billing.",
    );
    await Bun.write(join(projectDir, ".botholomew", "invoicing.md"), content);

    const prompt = await buildChatSystemPrompt(projectDir, {
      keywordSource: "deployment pipeline help",
    });
    expect(prompt).not.toContain("invoicing.md");
    expect(prompt).not.toContain("Our invoicing system uses Stripe");
  });

  test("excludes contextual files when no keywordSource is given", async () => {
    const content = serializeContextFile(
      { loading: "contextual", "agent-modification": false },
      "Our invoicing system uses Stripe for billing.",
    );
    await Bun.write(join(projectDir, ".botholomew", "invoicing.md"), content);

    const prompt = await buildChatSystemPrompt(projectDir);
    expect(prompt).not.toContain("invoicing.md");
    expect(prompt).not.toContain("Our invoicing system uses Stripe");
  });

  test("includes MCP section with mcp_info requirement when hasMcpTools is true", async () => {
    const prompt = await buildChatSystemPrompt(projectDir, {
      hasMcpTools: true,
    });
    expect(prompt).toContain("## External Tools (MCP)");
    expect(prompt).toContain("MUST fetch its schema first");
    expect(prompt).toContain("`mcp_info`");
    expect(prompt).toContain("`mcp_exec`");
    expect(prompt).toContain("`mcp_search`");
    expect(prompt).toContain("`mcp_list_tools`");
    expect(prompt).toContain("check local context first");
    expect(prompt).toContain("`search_semantic`");
    expect(prompt).toContain("`context_search`");
  });

  test("omits MCP section when hasMcpTools is false or absent", async () => {
    const promptNoOpts = await buildChatSystemPrompt(projectDir);
    expect(promptNoOpts).not.toContain("## External Tools (MCP)");

    const promptFalse = await buildChatSystemPrompt(projectDir, {
      hasMcpTools: false,
    });
    expect(promptFalse).not.toContain("## External Tools (MCP)");
  });

  test("always-loaded files appear even when keywordSource matches nothing", async () => {
    const always = serializeContextFile(
      { loading: "always", "agent-modification": true },
      "Beliefs content here.",
    );
    await Bun.write(join(projectDir, ".botholomew", "beliefs.md"), always);

    const prompt = await buildChatSystemPrompt(projectDir, {
      keywordSource: "zzz nonmatching xyzzy",
    });
    expect(prompt).toContain("Beliefs content here.");
  });
});
