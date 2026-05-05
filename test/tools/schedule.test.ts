import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getSchedulesDir, getSchedulesLockDir } from "../../src/constants.ts";
import { createSchedule, updateSchedule } from "../../src/schedules/store.ts";
import { createScheduleTool } from "../../src/tools/schedule/create.ts";
import { listSchedulesTool } from "../../src/tools/schedule/list.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let projectDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-schedule-tools-"));
  await mkdir(getSchedulesDir(projectDir), { recursive: true });
  await mkdir(getSchedulesLockDir(projectDir), { recursive: true });
  ctx = {
    conn: null as never,
    dbPath: ":memory:",
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("create_schedule", () => {
  test("creates a schedule", async () => {
    const result = await createScheduleTool.execute(
      { name: "Morning", frequency: "every weekday at 7am" },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.id).toBeTruthy();
    expect(result.message).toContain("Morning");
    expect(result.message).toContain("every weekday at 7am");
  });

  test("creates a schedule with description", async () => {
    const result = await createScheduleTool.execute(
      {
        name: "n",
        description: "do stuff",
        frequency: "daily",
      },
      ctx,
    );
    expect(result.is_error).toBe(false);
  });

  test("validates input schema rejects missing frequency", () => {
    const r = createScheduleTool.inputSchema.safeParse({ name: "n" });
    expect(r.success).toBe(false);
  });

  test("validates input schema rejects missing name", () => {
    const r = createScheduleTool.inputSchema.safeParse({ frequency: "daily" });
    expect(r.success).toBe(false);
  });
});

describe("list_schedules", () => {
  test("returns empty array initially", async () => {
    const r = await listSchedulesTool.execute({}, ctx);
    expect(r.schedules).toEqual([]);
    expect(r.count).toBe(0);
  });

  test("returns created schedules", async () => {
    await createSchedule(projectDir, { name: "a", frequency: "daily" });
    await createSchedule(projectDir, { name: "b", frequency: "weekly" });
    const r = await listSchedulesTool.execute({}, ctx);
    expect(r.count).toBe(2);
    const names = r.schedules.map((s) => s.name).sort();
    expect(names).toEqual(["a", "b"]);
  });

  test("filters by enabled", async () => {
    const a = await createSchedule(projectDir, {
      name: "a",
      frequency: "daily",
    });
    await createSchedule(projectDir, { name: "b", frequency: "weekly" });
    await updateSchedule(projectDir, a.id, { enabled: false });

    const enabled = await listSchedulesTool.execute({ enabled: true }, ctx);
    expect(enabled.count).toBe(1);
    expect(enabled.schedules[0]?.name).toBe("b");

    const disabled = await listSchedulesTool.execute({ enabled: false }, ctx);
    expect(disabled.count).toBe(1);
    expect(disabled.schedules[0]?.name).toBe("a");
  });
});
