import { describe, expect, it } from "bun:test";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { fitToContextWindow } from "../../src/daemon/context.ts";

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
});
