import { describe, expect, test } from "bun:test";
import { buildChatSystemPrompt, getChatTools } from "../../src/chat/agent.ts";

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
    const prompt = await buildChatSystemPrompt("/tmp/test-project");
    expect(prompt).toContain("Botholomew");
    expect(prompt).toContain("interactive chat interface");
    expect(prompt).toContain("create_task");
    expect(prompt).not.toContain("You are the Botholomew daemon");
  });

  test("includes meta header", async () => {
    const prompt = await buildChatSystemPrompt("/tmp/test-project");
    expect(prompt).toContain("Current time:");
    expect(prompt).toContain("/tmp/test-project");
  });
});
