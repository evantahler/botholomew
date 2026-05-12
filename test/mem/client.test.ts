import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveMembotDir } from "../../src/mem/client.ts";

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
