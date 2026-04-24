import { beforeEach, describe, expect, test } from "bun:test";
import { contextListDrivesTool } from "../../src/tools/context/list-drives.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { seedFile, setupToolContext } from "../helpers.ts";

let ctx: ToolContext;

beforeEach(async () => {
  ({ ctx } = await setupToolContext());
});

describe("context_list_drives", () => {
  test("returns empty list with hint when DB is empty", async () => {
    const result = await contextListDrivesTool.execute({}, ctx);
    expect(result.is_error).toBe(false);
    expect(result.drives).toEqual([]);
    expect(result.hint).toContain("No context");
  });

  test("aggregates counts per drive", async () => {
    await seedFile(ctx.conn, { drive: "agent", path: "/a.md" }, "a");
    await seedFile(ctx.conn, { drive: "agent", path: "/b.md" }, "b");
    await seedFile(ctx.conn, { drive: "disk", path: "/tmp/c.md" }, "c");

    const result = await contextListDrivesTool.execute({}, ctx);
    expect(result.is_error).toBe(false);
    const byDrive = new Map(result.drives.map((d) => [d.drive, d.count]));
    expect(byDrive.get("agent")).toBe(2);
    expect(byDrive.get("disk")).toBe(1);
  });
});
