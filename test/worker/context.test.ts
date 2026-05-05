/**
 * fitToContextWindow trims the message history when it would exceed the
 * model's input-token budget. The actual model lookup goes through
 * Anthropic's API and is best left untested here; we exercise the pure
 * trimming/truncation behavior.
 */

import { describe, expect, test } from "bun:test";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { fitToContextWindow } from "../../src/worker/context.ts";

function userMsg(content: string): MessageParam {
  return { role: "user", content };
}

function assistantMsg(content: string): MessageParam {
  return { role: "assistant", content };
}

function toolResultMsg(id: string, text: string): MessageParam {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: id,
        content: text,
      },
    ],
  };
}

describe("fitToContextWindow", () => {
  test("returns messages unchanged when total fits in budget", () => {
    const msgs: MessageParam[] = [
      userMsg("first"),
      assistantMsg("hello"),
      userMsg("second"),
    ];
    const out = fitToContextWindow(msgs, "system prompt", 200_000);
    expect(out).toBe(msgs); // same reference
    expect(out.map((m) => m.content)).toEqual(["first", "hello", "second"]);
  });

  test("truncates oversized tool_result content blocks in place", () => {
    const huge = "x".repeat(100_000);
    const msgs: MessageParam[] = [
      userMsg("query"),
      toolResultMsg("call_1", huge),
    ];
    fitToContextWindow(msgs, "sys", 200_000);
    const block = (msgs[1]?.content as Array<{ content: string }>)[0];
    if (!block) throw new Error("missing block");
    expect(block.content.length).toBeLessThan(huge.length);
    expect(block.content).toContain("[truncated:");
  });

  test("drops the oldest non-first message when the budget is exceeded", () => {
    // After reserving 4096 (response buffer) + 10% headroom from the
    // budget, ~6000 tokens here leaves ~1300 tokens for messages. The
    // four 500-token middles can't all fit, so the trimmer must drop
    // some — keeping the first user message and the most recent.
    const msgs: MessageParam[] = [
      userMsg("first"),
      assistantMsg("a".repeat(2_000)), // ~500 tokens
      userMsg("b".repeat(2_000)),
      assistantMsg("c".repeat(2_000)),
      userMsg("recent"),
    ];
    fitToContextWindow(msgs, "sys", 6_000);

    expect(msgs[0]?.content).toBe("first");
    expect(msgs[msgs.length - 1]?.content).toBe("recent");
    expect(msgs.length).toBeLessThan(5);
  });

  test("keeps the first message even when budget is way too small", () => {
    const msgs: MessageParam[] = [
      userMsg("first"),
      assistantMsg("a".repeat(10_000)),
      userMsg("recent"),
    ];
    // System-prompt-bigger-than-budget path returns unchanged (logged warn).
    fitToContextWindow(msgs, "sys", 100);
    expect(msgs[0]?.content).toBe("first");
  });

  test("logs and returns unchanged if the system prompt itself exceeds the budget", () => {
    const msgs: MessageParam[] = [userMsg("hello")];
    // System prompt longer than the budget allows after headroom +
    // response-buffer reservation.
    const out = fitToContextWindow(msgs, "x".repeat(50_000), 1_000);
    expect(out.length).toBe(1);
    expect(out[0]?.content).toBe("hello");
  });
});
