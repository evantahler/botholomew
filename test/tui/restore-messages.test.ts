import { describe, expect, test } from "bun:test";
import type { Interaction } from "../../src/threads/store.ts";
import { restoreMessagesFromInteractions } from "../../src/tui/restoreMessages.ts";

let seq = 0;
function ix(
  partial: Partial<Interaction> & Pick<Interaction, "kind" | "role">,
): Interaction {
  seq += 1;
  return {
    id: `t:${seq}`,
    thread_id: "t",
    sequence: seq,
    role: partial.role,
    kind: partial.kind,
    content: partial.content ?? "",
    tool_name: partial.tool_name ?? null,
    tool_input: partial.tool_input ?? null,
    duration_ms: null,
    token_count: null,
    created_at: partial.created_at ?? new Date(0),
  };
}

describe("restoreMessagesFromInteractions", () => {
  test("returns [] for empty interactions", () => {
    expect(restoreMessagesFromInteractions([])).toEqual([]);
  });

  test("attaches tools to the issuing assistant, not the next one", () => {
    const interactions: Interaction[] = [
      ix({ kind: "message", role: "user", content: "hi" }),
      ix({ kind: "message", role: "assistant", content: "I'll check" }),
      ix({
        kind: "tool_use",
        role: "assistant",
        tool_name: "context_read",
        tool_input: '{"path":"a.md"}',
      }),
      ix({
        kind: "tool_result",
        role: "tool",
        tool_name: "context_read",
        content: "file body",
      }),
      ix({ kind: "message", role: "assistant", content: "here you go" }),
    ];

    const msgs = restoreMessagesFromInteractions(interactions);
    expect(msgs).toHaveLength(3);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.role).toBe("assistant");
    expect(msgs[1]?.content).toBe("I'll check");
    expect(msgs[1]?.toolCalls).toHaveLength(1);
    expect(msgs[1]?.toolCalls?.[0]?.name).toBe("context_read");
    expect(msgs[1]?.toolCalls?.[0]?.output).toBe("file body");
    expect(msgs[1]?.toolCalls?.[0]?.running).toBe(false);
    expect(msgs[2]?.role).toBe("assistant");
    expect(msgs[2]?.content).toBe("here you go");
    expect(msgs[2]?.toolCalls).toBeUndefined();
  });

  test("creates a synthetic assistant for tools with no following message", () => {
    const interactions: Interaction[] = [
      ix({ kind: "message", role: "user", content: "do it" }),
      ix({
        kind: "tool_use",
        role: "assistant",
        tool_name: "search_threads",
        tool_input: '{"q":"x"}',
      }),
      ix({
        kind: "tool_result",
        role: "tool",
        tool_name: "search_threads",
        content: "[]",
      }),
    ];

    const msgs = restoreMessagesFromInteractions(interactions);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.role).toBe("assistant");
    expect(msgs[1]?.content).toBe("");
    expect(msgs[1]?.toolCalls).toHaveLength(1);
    expect(msgs[1]?.toolCalls?.[0]?.name).toBe("search_threads");
    expect(msgs[1]?.toolCalls?.[0]?.output).toBe("[]");
  });

  test("multiple tools in the same turn all attach to the same assistant", () => {
    const interactions: Interaction[] = [
      ix({ kind: "message", role: "user", content: "go" }),
      ix({ kind: "message", role: "assistant", content: "doing two things" }),
      ix({
        kind: "tool_use",
        role: "assistant",
        tool_name: "tool_p",
        tool_input: "{}",
      }),
      ix({
        kind: "tool_use",
        role: "assistant",
        tool_name: "tool_q",
        tool_input: "{}",
      }),
      ix({
        kind: "tool_result",
        role: "tool",
        tool_name: "tool_p",
        content: "p out",
      }),
      ix({
        kind: "tool_result",
        role: "tool",
        tool_name: "tool_q",
        content: "q out",
      }),
    ];

    const msgs = restoreMessagesFromInteractions(interactions);
    expect(msgs).toHaveLength(2);
    const calls = msgs[1]?.toolCalls;
    expect(calls).toHaveLength(2);
    expect(calls?.[0]?.name).toBe("tool_p");
    expect(calls?.[0]?.output).toBe("p out");
    expect(calls?.[1]?.name).toBe("tool_q");
    expect(calls?.[1]?.output).toBe("q out");
  });

  test("flags tool errors when the result JSON has is_error", () => {
    const interactions: Interaction[] = [
      ix({ kind: "message", role: "user", content: "go" }),
      ix({ kind: "message", role: "assistant", content: "trying" }),
      ix({
        kind: "tool_use",
        role: "assistant",
        tool_name: "tool_x",
        tool_input: "{}",
      }),
      ix({
        kind: "tool_result",
        role: "tool",
        tool_name: "tool_x",
        content: '{"is_error":true,"message":"boom"}',
      }),
    ];

    const msgs = restoreMessagesFromInteractions(interactions);
    expect(msgs[1]?.toolCalls?.[0]?.isError).toBe(true);
  });
});
