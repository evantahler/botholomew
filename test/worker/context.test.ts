import { describe, expect, it, mock } from "bun:test";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { fitToContextWindow } from "../../src/worker/context.ts";
import { MockAnthropicModels } from "../helpers.ts";

mock.module("@anthropic-ai/sdk", () => ({ default: MockAnthropicModels }));

const { getMaxInputTokens } = await import("../../src/worker/context.ts");

describe("fitToContextWindow", () => {
  const defaultLimit = 200_000;

  it("returns messages unchanged when under the token budget", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    const result = fitToContextWindow(
      messages,
      "You are a helpful assistant.",
      defaultLimit,
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.content).toBe("Hello");
  });

  it("truncates oversized tool results", () => {
    const bigContent = "x".repeat(100_000);
    const messages: MessageParam[] = [
      { role: "user", content: "Hello" },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "test-id",
            content: bigContent,
          },
        ],
      },
    ];

    fitToContextWindow(messages, "system", defaultLimit);
    const block = (messages[1]?.content as Array<{ content: string }>)[0];
    expect(block?.content.length).toBeLessThan(bigContent.length);
    expect(block?.content).toContain("[truncated:");
  });

  it("drops older messages when conversation exceeds budget", () => {
    // Create a very large conversation that will exceed 180K tokens
    // At ~4 chars/token, 180K tokens ≈ 720K chars
    const bigText = "x".repeat(200_000);
    const messages: MessageParam[] = [
      { role: "user", content: "Initial task" },
      { role: "assistant", content: bigText },
      { role: "user", content: bigText },
      { role: "assistant", content: bigText },
      { role: "user", content: bigText },
      { role: "assistant", content: "Recent response" },
    ];

    const result = fitToContextWindow(messages, "system prompt", defaultLimit);

    // Should have dropped some middle messages
    expect(result.length).toBeLessThan(6);
    // First message should be preserved
    expect(result[0]?.content).toBe("Initial task");
    // Last message should still be present
    expect(result[result.length - 1]?.content).toBe("Recent response");
  });

  it("respects a smaller maxInputTokens limit", () => {
    // With a 10K token limit (~40K chars), even modest messages get trimmed
    const text = "x".repeat(20_000);
    const messages: MessageParam[] = [
      { role: "user", content: "Initial" },
      { role: "assistant", content: text },
      { role: "user", content: text },
      { role: "assistant", content: "Latest" },
    ];

    const result = fitToContextWindow(messages, "system", 10_000);
    expect(result.length).toBeLessThan(4);
    expect(result[0]?.content).toBe("Initial");
  });

  it("preserves all messages when system prompt is small and conversation is short", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Do something" },
      { role: "assistant", content: "Done!" },
      { role: "user", content: "Thanks" },
    ];
    const result = fitToContextWindow(messages, "Be helpful.", defaultLimit);
    expect(result).toHaveLength(3);
  });

  it("handles system prompt that fills the entire budget", () => {
    // A system prompt that consumes all tokens — budget becomes <= 0
    const hugeSystemPrompt = "x".repeat(defaultLimit * 4); // way over
    const messages: MessageParam[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ];
    // Should not throw, should return messages unchanged (warning logged)
    const result = fitToContextWindow(messages, hugeSystemPrompt, defaultLimit);
    expect(result).toHaveLength(2);
  });

  it("does not truncate tool results under the threshold", () => {
    const smallContent = "x".repeat(1000);
    const messages: MessageParam[] = [
      { role: "user", content: "Hello" },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "test-id",
            content: smallContent,
          },
        ],
      },
    ];

    fitToContextWindow(messages, "system", defaultLimit);
    const block = (messages[1]?.content as Array<{ content: string }>)[0];
    expect(block?.content).toBe(smallContent);
    expect(block?.content).not.toContain("[truncated:");
  });

  it("handles messages with mixed content block types", () => {
    const messages: MessageParam[] = [
      { role: "user", content: "Start" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll call a tool." },
          {
            type: "tool_use",
            id: "tool_1",
            name: "test",
            input: { key: "value" },
          },
        ],
      },
    ];
    // Should not crash on mixed block types
    const result = fitToContextWindow(messages, "system", defaultLimit);
    expect(result).toHaveLength(2);
  });
});

describe("getMaxInputTokens", () => {
  it("returns the model's max_input_tokens from API", async () => {
    const result = await getMaxInputTokens("test-key", "test-model-unique");
    expect(result).toBe(100_000);
  });

  it("caches results for same model", async () => {
    // First call hits API, second uses cache
    const r1 = await getMaxInputTokens("test-key", "cached-model");
    const r2 = await getMaxInputTokens("test-key", "cached-model");
    expect(r1).toBe(r2);
  });

  it("returns default when API fails", async () => {
    const result = await getMaxInputTokens("test-key", "fail-model");
    expect(result).toBe(200_000); // DEFAULT_MAX_INPUT_TOKENS
  });
});
