import { afterEach, describe, expect, test } from "bun:test";
import type { ToolContext } from "../../src/tools/tool.ts";
import { readLargeResultTool } from "../../src/tools/util/read_large_result.ts";
import {
  clearLargeResults,
  MAX_INLINE_CHARS,
  maybeStoreResult,
  PAGE_SIZE_CHARS,
  peekLargeResult,
  readLargeResultPage,
} from "../../src/worker/large-results.ts";

function makeCtx(): ToolContext {
  return {
    withMem: undefined as unknown as ToolContext["withMem"],
    projectDir: "/tmp/lr-test",
    // biome-ignore lint/suspicious/noExplicitAny: tests don't exercise config
    config: {} as any,
    mcpxClient: null,
  };
}

afterEach(() => {
  clearLargeResults();
});

describe("maybeStoreResult", () => {
  test("passes through small outputs unchanged", () => {
    const small = "hello";
    const result = maybeStoreResult("any_tool", small);
    expect(result.text).toBe(small);
    expect(result.stored).toBeUndefined();
  });

  test("stores oversized outputs and returns a stub with the new hint", () => {
    const huge = "x".repeat(MAX_INLINE_CHARS + 5_000);
    const result = maybeStoreResult("big_tool", huge);

    expect(result.stored).toBeDefined();
    expect(result.stored?.id).toMatch(/^lr_\d+$/);
    expect(result.stored?.chars).toBe(huge.length);
    expect(result.stored?.pages).toBe(Math.ceil(huge.length / PAGE_SIZE_CHARS));

    expect(result.text).toContain("stored as");
    expect(result.text).toContain(`id="${result.stored?.id}"`);
    expect(result.text).toContain("page=<n>");
    expect(result.text).toContain(`(1–${result.stored?.pages})`);
    expect(result.text).toContain("read_large_result");
    expect(result.text).toContain("NOT via mcp_exec");
  });
});

describe("read_large_result tool", () => {
  test("round-trips a stored payload across pages", async () => {
    const a = "a".repeat(PAGE_SIZE_CHARS);
    const b = "b".repeat(PAGE_SIZE_CHARS);
    const c = "c".repeat(1_000);
    const payload = a + b + c;
    expect(payload.length).toBeGreaterThan(MAX_INLINE_CHARS);

    const stored = maybeStoreResult("big_tool", payload);
    const id = stored.stored?.id ?? "";
    expect(id).toMatch(/^lr_\d+$/);

    const meta = peekLargeResult(id);
    expect(meta).not.toBeNull();
    expect(meta?.totalPages).toBe(3);
    expect(meta?.totalChars).toBe(payload.length);

    const page1 = await readLargeResultTool.execute({ id, page: 1 }, makeCtx());
    expect(page1.is_error).toBe(false);
    expect(page1.content).toBe(a);
    expect(page1.page).toBe(1);
    expect(page1.total_pages).toBe(3);
    expect(page1.total_chars).toBe(payload.length);

    const page2 = await readLargeResultTool.execute({ id, page: 2 }, makeCtx());
    expect(page2.is_error).toBe(false);
    expect(page2.content).toBe(b);

    const page3 = await readLargeResultTool.execute({ id, page: 3 }, makeCtx());
    expect(page3.is_error).toBe(false);
    expect(page3.content).toBe(c);
  });

  test("unknown id returns a recoverable error", async () => {
    const result = await readLargeResultTool.execute(
      { id: "lr_99999", page: 1 },
      makeCtx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("unknown_id");
    expect(result.total_pages).toBe(0);
    expect(result.next_action_hint).toMatch(/Re-run/i);
  });

  test("page past end reports the real total_pages", async () => {
    const payload = "z".repeat(MAX_INLINE_CHARS + 100);
    const stored = maybeStoreResult("big_tool", payload);
    const id = stored.stored?.id ?? "";

    const total = stored.stored?.pages ?? 0;
    const result = await readLargeResultTool.execute(
      { id, page: total + 5 },
      makeCtx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("page_out_of_range");
    expect(result.total_pages).toBe(total);
    expect(result.next_action_hint).toContain(`1–${total}`);
  });

  test("rejects ids that don't match lr_<n> at the schema layer", () => {
    const parsed = readLargeResultTool.inputSchema.safeParse({
      id: "not-an-id",
      page: 1,
    });
    expect(parsed.success).toBe(false);
  });

  test("defaults page to 1 when omitted", () => {
    const parsed = readLargeResultTool.inputSchema.safeParse({ id: "lr_1" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(1);
    }
  });
});

describe("clearLargeResults", () => {
  test("removes entries so subsequent reads miss", async () => {
    const payload = "y".repeat(MAX_INLINE_CHARS + 100);
    const stored = maybeStoreResult("big_tool", payload);
    const id = stored.stored?.id ?? "";

    expect(peekLargeResult(id)).not.toBeNull();
    clearLargeResults();
    expect(peekLargeResult(id)).toBeNull();

    const result = await readLargeResultTool.execute(
      { id, page: 1 },
      makeCtx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("unknown_id");
  });

  test("readLargeResultPage returns null for missing entries", () => {
    expect(readLargeResultPage("lr_does_not_exist" as string, 1)).toBeNull();
  });
});
