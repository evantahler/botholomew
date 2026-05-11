import { describe, expect, test } from "bun:test";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { sleepTool } from "../../../src/tools/util/sleep.ts";

function makeCtx(shouldAbort?: () => boolean): ToolContext {
  return {
    mem: undefined as unknown as ToolContext["mem"],
    projectDir: "/tmp/sleep-test",
    // biome-ignore lint/suspicious/noExplicitAny: tests don't exercise config
    config: {} as any,
    mcpxClient: null,
    shouldAbort,
  };
}

describe("sleepTool", () => {
  test("sleeps for the requested duration and returns aborted=false", async () => {
    const start = Date.now();
    const result = await sleepTool.execute(
      { seconds: 1, reason: "smoke test" },
      makeCtx(),
    );
    const elapsed = Date.now() - start;
    expect(result.aborted).toBe(false);
    expect(result.is_error).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(1500);
    expect(result.slept_seconds).toBeGreaterThanOrEqual(0.9);
    expect(result.message).toContain("smoke test");
  });

  test("returns early when shouldAbort flips to true", async () => {
    let aborted = false;
    const start = Date.now();
    const promise = sleepTool.execute(
      { seconds: 60, reason: "long sleep" },
      makeCtx(() => aborted),
    );
    setTimeout(() => {
      aborted = true;
    }, 300);
    const result = await promise;
    const elapsed = Date.now() - start;
    expect(result.aborted).toBe(true);
    expect(result.is_error).toBe(false);
    expect(elapsed).toBeLessThan(1500);
    expect(result.slept_seconds).toBeLessThan(1.5);
    expect(result.message).toContain("interrupted");
  });

  test("rejects out-of-range durations", () => {
    expect(
      sleepTool.inputSchema.safeParse({ seconds: 0, reason: "x" }).success,
    ).toBe(false);
    expect(
      sleepTool.inputSchema.safeParse({ seconds: 4000, reason: "x" }).success,
    ).toBe(false);
    expect(
      sleepTool.inputSchema.safeParse({ seconds: 1.5, reason: "x" }).success,
    ).toBe(false);
    expect(
      sleepTool.inputSchema.safeParse({ seconds: 5, reason: "" }).success,
    ).toBe(false);
    expect(
      sleepTool.inputSchema.safeParse({ seconds: 5, reason: "ok" }).success,
    ).toBe(true);
  });
});
