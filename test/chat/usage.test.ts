import { describe, expect, test } from "bun:test";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
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
    const messages: MessageParam[] = [
      { role: "user", content: "hello world" }, // 11 chars
      { role: "assistant", content: "ok" }, // 2 chars
    ];
    expect(partitionMessages(messages)).toEqual({
      textChars: 13,
      toolIoChars: 0,
    });
  });

  test("text blocks count as text; tool_use and tool_result count as tool I/O", () => {
    const toolUse = {
      type: "tool_use" as const,
      id: "tu_1",
      name: "list_tasks",
      input: { limit: 5 },
    };
    const messages: MessageParam[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling tool" }, // 12 chars text
          toolUse,
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: "[]",
          },
        ],
      },
    ];
    const { textChars, toolIoChars } = partitionMessages(messages);
    expect(textChars).toBe(12);
    // tool_use serialized as JSON + tool_result string content (2 chars).
    expect(toolIoChars).toBe(JSON.stringify(toolUse).length + 2);
  });

  test("non-string tool_result content is JSON-stringified", () => {
    const messages: MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: [{ type: "text", text: "structured" }],
          },
        ],
      },
    ];
    const { textChars, toolIoChars } = partitionMessages(messages);
    expect(textChars).toBe(0);
    expect(toolIoChars).toBeGreaterThan(0);
  });
});
