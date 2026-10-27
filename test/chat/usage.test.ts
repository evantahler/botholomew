import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { estimateTokens, partitionMessages } from "../../src/chat/usage.ts";

describe("estimateTokens", () => {
  test("rounds up at 4 chars/token", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(400)).toBe(100);
  });
});

describe("partitionMessages", () => {
  test("plain string content counts as text", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello world" }, // 11 chars
      { role: "assistant", content: "ok" }, // 2 chars
    ];
    expect(partitionMessages(messages)).toEqual({
      textChars: 13,
      toolIoChars: 0,
    });
  });

  test("text parts count as text; tool-call and tool-result count as tool I/O", () => {
    const toolCall = {
      type: "tool-call" as const,
      toolCallId: "tu_1",
      toolName: "list_tasks",
      input: { limit: 5 },
    };
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling tool" }, // 12 chars text
          toolCall,
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tu_1",
            toolName: "list_tasks",
            output: { type: "text", value: "[]" },
          },
        ],
      },
    ];
    const { textChars, toolIoChars } = partitionMessages(messages);
    expect(textChars).toBe(12);
    expect(toolIoChars).toBe(JSON.stringify(toolCall).length + 2);
  });

  test("non-string tool-result value is JSON-stringified", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tu_1",
            toolName: "x",
            output: { type: "json", value: { foo: "bar" } },
          },
        ],
      },
    ];
    const { textChars, toolIoChars } = partitionMessages(messages);
    expect(textChars).toBe(0);
    expect(toolIoChars).toBeGreaterThan(0);
  });
});
