import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MembotClient } from "membot";
import { membotRunTool } from "../../../src/tools/membot/run.ts";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

let mem: MembotClient;
let ctx: ToolContext;
let cleanup: () => Promise<void>;

const SAMPLE = [
  { ts: "2026-05-31T10:00:00Z", email: "a@x.com", amount: 50 },
  { ts: "2026-05-31T12:00:00Z", email: "a@x.com", amount: 120 },
  { ts: "2026-06-01T09:00:00Z", email: "b@x.com", amount: 200 },
];

async function seed(logical_path: string, value: unknown): Promise<void> {
  const content =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  await mem.write({ logical_path, content });
}

beforeEach(async () => {
  ({ mem, ctx, cleanup } = await setupToolContext());
});

afterEach(async () => {
  await cleanup();
});

describe("membot_run", () => {
  test("groups and counts a JSON array inline", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotRunTool.execute(
      {
        source: `
          const rows = await files.readJson("mcp/inbox.json");
          return rows.reduce((counts, row) => {
            const day = String(row.ts).slice(0, 10);
            counts[day] = (counts[day] ?? 0) + 1;
            return counts;
          }, {});
        `,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: false,
      result_type: "object",
      result: { "2026-05-31": 2, "2026-06-01": 1 },
    });
  });

  test("reports array element count for an array result", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotRunTool.execute(
      {
        source: `
          const rows = await files.readJson("mcp/inbox.json");
          return rows.filter((row) => row.amount > 100);
        `,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: false,
      result_type: "array",
      result_count: 2,
    });
  });

  test("writes the result to output_logical_path and is re-readable", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotRunTool.execute(
      {
        source: `
          const rows = await files.readJson("mcp/inbox.json");
          return [...new Set(rows.map((row) => row.email))];
        `,
        output_logical_path: "mcp/emails.json",
        change_note: "deduped",
      },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r).toMatchObject({
      logical_path: "mcp/emails.json",
      preview: expect.stringContaining("a@x.com"),
    });
    if (!("bytes_written" in r) || r.bytes_written === undefined) {
      throw new Error("expected write ack");
    }
    expect(r.bytes_written).toBeGreaterThan(0);
    expect(r.version_id).toBeDefined();

    const back = await mem.read({ logical_path: "mcp/emails.json" });
    expect(JSON.parse(back.content ?? "")).toEqual(["a@x.com", "b@x.com"]);
  });

  test("returns invalid_json for a non-JSON source", async () => {
    await seed("notes/plain.md", "just some prose, not json");
    const r = await membotRunTool.execute(
      {
        source: `return await files.readJson("notes/plain.md");`,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: true,
      error_type: "invalid_json",
    });
    expect(r.is_error && r.next_action_hint).toContain("files.readText");
  });

  test("source '?' returns the primer without running", async () => {
    const r = await membotRunTool.execute({ source: "?" }, ctx);
    expect(r.is_error).toBe(false);
    expect("message" in r && r.message).toContain("membot_run host API");
    expect("result" in r ? r.result : undefined).toBeUndefined();
  });

  test("empty source also returns the primer", async () => {
    const r = await membotRunTool.execute({ source: "   " }, ctx);
    expect(r.is_error).toBe(false);
    expect("message" in r && r.message).toContain("membot_run host API");
  });

  test("returns source_too_large when content exceeds max_input_bytes", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotRunTool.execute(
      {
        source: `return await files.readJson("mcp/inbox.json");`,
        max_input_bytes: 5,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: true,
      error_type: "source_too_large",
    });
  });

  test("returns source_not_found for a missing logical_path", async () => {
    const r = await membotRunTool.execute(
      { source: `return await files.readJson("nope/missing.json");` },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: true,
      error_type: "source_not_found",
    });
  });

  test("files.exists / writeJson / list work", async () => {
    await seed("a.json", { n: 1 });
    const r = await membotRunTool.execute(
      {
        source: `
          const existed = await files.exists("a.json");
          await files.writeJson("b.json", { n: 2 }, "copy");
          const listed = await files.list({ limit: 10 });
          return { existed, paths: listed.entries.map((e) => e.logical_path) };
        `,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: false,
      result: {
        existed: true,
        paths: expect.arrayContaining(["a.json", "b.json"]),
      },
    });
  });

  test("joins two JSON files", async () => {
    await seed("left.json", [{ id: 1, name: "a" }]);
    await seed("right.json", [{ id: 1, extra: true }]);
    const r = await membotRunTool.execute(
      {
        source: `
          const [left, right] = await Promise.all([
            files.readJson("left.json"),
            files.readJson("right.json"),
          ]);
          return left.map((row) => ({
            ...row,
            ...right.find((other) => other.id === row.id),
          }));
        `,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: false,
      result: [{ id: 1, name: "a", extra: true }],
    });
  });

  test("accepts type-stripped TypeScript", async () => {
    await seed("n.json", [1, 2, 3]);
    const r = await membotRunTool.execute(
      {
        source: `
          const nums: number[] = await files.readJson("n.json");
          const total: number = nums.reduce((sum: number, n: number) => sum + n, 0);
          return total;
        `,
      },
      ctx,
    );
    expect(r).toMatchObject({ is_error: false, result: 6 });
  });
});
