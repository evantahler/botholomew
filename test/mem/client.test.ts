import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MembotClient } from "membot";
import { resolveMembotDir, sharedWithMem } from "../../src/mem/client.ts";

describe("resolveMembotDir", () => {
  test('"global" resolves to ~/.membot regardless of projectDir', () => {
    expect(resolveMembotDir("/tmp/project-a", { membot_scope: "global" })).toBe(
      join(homedir(), ".membot"),
    );
    expect(resolveMembotDir("/tmp/project-b", { membot_scope: "global" })).toBe(
      join(homedir(), ".membot"),
    );
  });

  test('"project" resolves to the project dir', () => {
    expect(
      resolveMembotDir("/tmp/project-a", { membot_scope: "project" }),
    ).toBe("/tmp/project-a");
  });

  test("missing scope falls back to global (so existing projects opt into the new default)", () => {
    expect(resolveMembotDir("/tmp/proj", {})).toBe(join(homedir(), ".membot"));
  });
});

describe("sharedWithMem", () => {
  // membot releases its DuckDB connection in a `finally` after every op, so
  // concurrent ops on the same client tear each other's connection down.
  // `sharedWithMem` must queue them.
  test("serializes concurrent callers — second op doesn't start until first resolves", async () => {
    const fakeMem = {} as MembotClient;
    const withMem = sharedWithMem(fakeMem);
    const events: string[] = [];

    let resolveFirst!: () => void;
    const firstStarted = new Promise<void>(() => {});
    const firstDone = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const p1 = withMem(async () => {
      events.push("a:start");
      await firstDone;
      events.push("a:end");
      return "a";
    });

    const p2 = withMem(async () => {
      events.push("b:start");
      return "b";
    });

    // Let the microtask queue run so p1 has a chance to start, p2 should NOT.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["a:start"]);

    resolveFirst();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    expect(events).toEqual(["a:start", "a:end", "b:start"]);
    // suppress unused-binding warning
    void firstStarted;
  });

  test("a rejected op doesn't block the queue", async () => {
    const fakeMem = {} as MembotClient;
    const withMem = sharedWithMem(fakeMem);

    const failing = withMem(async () => {
      throw new Error("boom");
    });
    const succeeding = withMem(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    expect(await succeeding).toBe("ok");
  });
});
