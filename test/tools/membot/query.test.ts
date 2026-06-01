import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MembotClient } from "membot";
import { membotQueryTool } from "../../../src/tools/membot/query.ts";
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

describe("membot_query", () => {
  test("groups and counts a JSON array inline", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotQueryTool.execute(
      {
        logical_path: "mcp/inbox.json",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal JSONata group syntax, not a JS template
        expression: "${ $substring(ts,0,10): $count($) }",
      },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.result_type).toBe("object");
    expect(r.result).toEqual({ "2026-05-31": 2, "2026-06-01": 1 });
  });

  test("reports array element count for an array result", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotQueryTool.execute(
      { logical_path: "mcp/inbox.json", expression: "$[amount > 100]" },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.result_type).toBe("array");
    expect(r.result_count).toBe(2);
  });

  test("writes the result to output_logical_path and is re-readable", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotQueryTool.execute(
      {
        logical_path: "mcp/inbox.json",
        expression: "$distinct(email)",
        output_logical_path: "mcp/emails.json",
        change_note: "deduped",
      },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.logical_path).toBe("mcp/emails.json");
    expect(r.version_id).toBeDefined();
    expect(r.bytes_written).toBeGreaterThan(0);
    expect(r.preview).toContain("a@x.com");

    const back = await mem.read({ logical_path: "mcp/emails.json" });
    expect(JSON.parse(back.content ?? "")).toEqual(["a@x.com", "b@x.com"]);
  });

  test("returns invalid_json for a non-JSON source", async () => {
    await seed("notes/plain.md", "just some prose, not json");
    const r = await membotQueryTool.execute(
      { logical_path: "notes/plain.md", expression: "$count($)" },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("invalid_json");
    expect(r.next_action_hint).toContain("membot_read");
  });

  test("returns invalid_expression with the primer on a bad expression", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotQueryTool.execute(
      { logical_path: "mcp/inbox.json", expression: "${ unclosed" },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("invalid_expression");
    expect(r.message).toContain("compile");
    expect(r.next_action_hint).toContain("JSONata syntax reference");
  });

  test('expression "?" returns the primer without reading the source', async () => {
    // logical_path intentionally does not exist — help must short-circuit.
    const r = await membotQueryTool.execute(
      { logical_path: "does/not/exist.json", expression: "?" },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.message).toContain("JSONata syntax reference");
    expect(r.result).toBeUndefined();
  });

  test("empty expression also returns the primer", async () => {
    const r = await membotQueryTool.execute(
      { logical_path: "does/not/exist.json", expression: "   " },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.message).toContain("JSONata syntax reference");
  });

  test("returns source_too_large when content exceeds max_input_bytes", async () => {
    await seed("mcp/inbox.json", SAMPLE);
    const r = await membotQueryTool.execute(
      {
        logical_path: "mcp/inbox.json",
        expression: "$count($)",
        max_input_bytes: 5,
      },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("source_too_large");
  });

  test("returns source_not_found for a missing logical_path", async () => {
    const r = await membotQueryTool.execute(
      { logical_path: "nope/missing.json", expression: "$count($)" },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("source_not_found");
  });
});
