import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { createScheduleTool } from "../../src/tools/schedule/create.ts";
import { listSchedulesTool } from "../../src/tools/schedule/list.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { setupToolContext } from "../helpers.ts";

let conn: DbConnection;
let ctx: ToolContext;

beforeEach(async () => {
  ({ conn, ctx } = await setupToolContext());
});

describe("create_schedule", () => {
  test("creates a schedule", async () => {
    const result = await createScheduleTool.execute(
      { name: "Morning email", frequency: "every morning" },
      ctx,
    );
    expect(result.id).toBeTruthy();
    expect(result.name).toBe("Morning email");
    expect(result.message).toContain("every morning");
  });

  test("creates a schedule with description", async () => {
    const result = await createScheduleTool.execute(
      {
        name: "Weekly report",
        frequency: "weekly on Mondays",
        description: "Generate summary",
      },
      ctx,
    );
    expect(result.name).toBe("Weekly report");
  });

  test("validates input: missing frequency", () => {
    const parsed = createScheduleTool.inputSchema.safeParse({ name: "Test" });
    expect(parsed.success).toBe(false);
  });
});

describe("list_schedules", () => {
  test("returns empty array initially", async () => {
    const result = await listSchedulesTool.execute({}, ctx);
    expect(result.schedules).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("returns created schedules", async () => {
    await createScheduleTool.execute({ name: "A", frequency: "daily" }, ctx);
    await createScheduleTool.execute({ name: "B", frequency: "weekly" }, ctx);

    const result = await listSchedulesTool.execute({}, ctx);
    expect(result.count).toBe(2);
    expect(result.schedules[0]?.name).toBe("A");
    expect(result.schedules[1]?.name).toBe("B");
  });

  test("filters by enabled", async () => {
    const { id } = await createScheduleTool.execute(
      { name: "Active", frequency: "daily" },
      ctx,
    );
    await createScheduleTool.execute(
      { name: "Also active", frequency: "weekly" },
      ctx,
    );

    // Disable one via direct DB update
    const { updateSchedule } = await import("../../src/db/schedules.ts");
    await updateSchedule(conn, id, { enabled: false });

    const enabled = await listSchedulesTool.execute({ enabled: true }, ctx);
    expect(enabled.count).toBe(1);
    expect(enabled.schedules[0]?.name).toBe("Also active");
  });
});
