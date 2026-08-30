import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { invokeSandbox } from "../../../src/tools/membot/run/execute.ts";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ ctx, cleanup } = await setupToolContext());
});

afterEach(async () => {
  await cleanup();
});

describe("membot_run sandbox isolation", () => {
  test("process, Bun, fetch, and require are unavailable", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `
        let requireFs = "threw";
        try {
          require("fs");
          requireFs = "loaded";
        } catch {
          requireFs = "threw";
        }
        return {
          process: typeof process,
          bun: typeof Bun,
          fetch: typeof fetch,
          requireFs,
        };
      `,
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toMatchObject({
      is_error: false,
      result: {
        process: "undefined",
        bun: "undefined",
        fetch: "undefined",
        requireFs: "threw",
      },
    });
  });

  test("dynamic evaluation is rejected", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `return eval("1+1");`,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(["invalid_source", "internal_error", "host_error"]).toContain(
      outcome.output.error_type,
    );
  });

  test("syntax errors map to invalid_source", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `const x = {`,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.output.error_type).toBe("invalid_source");
    expect(outcome.output.next_action_hint).toContain("files.readJson");
  });

  test("tight loops hit the sandbox timeout", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `let n = 0; while (true) n++; return n;`,
      limits: { timeoutMs: 200 },
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.output.error_type).toBe("sandbox_timeout");
  });
});
