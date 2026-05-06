import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getSchedulesDir, getSchedulesLockDir } from "../../src/constants.ts";
import { createSchedule, updateSchedule } from "../../src/schedules/store.ts";
import { createScheduleTool } from "../../src/tools/schedule/create.ts";
import { scheduleEditTool } from "../../src/tools/schedule/edit.ts";
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

  test("calls ctx.notify on success when provided", async () => {
    const notes: string[] = [];
    const notifyCtx: ToolContext = { ...ctx, notify: (m) => notes.push(m) };
    const result = await createScheduleTool.execute(
      { name: "Morning", frequency: "daily" },
      notifyCtx,
    );
    expect(result.is_error).toBe(false);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Created schedule: Morning");
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

describe("schedule_edit", () => {
  test("edits the body and bumps updated_at", async () => {
    const s = await createSchedule(projectDir, {
      name: "morning",
      description: "the description",
      frequency: "daily",
    });
    const filePath = join(getSchedulesDir(projectDir), `${s.id}.md`);
    const original = await Bun.file(filePath).text();
    const lines = original.split("\n");
    // Find the body line (after the closing `---`).
    const closingIdx = lines.findIndex((l, i) => i > 0 && l === "---");
    const bodyIdx = closingIdx + 3; // 1-based: skip closing `---`, blank line

    // Sleep so the timestamp can advance.
    await new Promise((r) => setTimeout(r, 5));

    const result = await scheduleEditTool.execute(
      {
        id: s.id,
        patches: [
          {
            start_line: bodyIdx,
            end_line: bodyIdx,
            content: "completely new body",
          },
        ],
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.applied).toBe(1);
    const after = await Bun.file(filePath).text();
    expect(after).toContain("completely new body");
    // updated_at was bumped past created_at
    const created = original.match(/created_at:\s*'?([^'\n]+)/)?.[1];
    const updated = after.match(/updated_at:\s*'?([^'\n]+)/)?.[1];
    expect(created && updated).toBeTruthy();
    expect(Date.parse(updated as string)).toBeGreaterThan(
      Date.parse(created as string),
    );
  });

  test("rolls back when patch breaks frontmatter", async () => {
    const s = await createSchedule(projectDir, {
      name: "n",
      frequency: "daily",
    });
    const filePath = join(getSchedulesDir(projectDir), `${s.id}.md`);
    const before = await Bun.file(filePath).text();

    const result = await scheduleEditTool.execute(
      {
        id: s.id,
        // Replace the closing `---` so frontmatter is unterminated.
        patches: [{ start_line: 2, end_line: 2, content: "name: 'oops" }],
      },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_schedule");
    const after = await Bun.file(filePath).text();
    expect(after).toBe(before);
  });

  test("rolls back when patch changes id frontmatter", async () => {
    const s = await createSchedule(projectDir, {
      name: "n",
      frequency: "daily",
    });
    const filePath = join(getSchedulesDir(projectDir), `${s.id}.md`);
    const before = await Bun.file(filePath).text();
    const lines = before.split("\n");
    const idLine = lines.findIndex((l) => l.startsWith("id:")) + 1;

    const result = await scheduleEditTool.execute(
      {
        id: s.id,
        patches: [
          { start_line: idLine, end_line: idLine, content: "id: not-the-id" },
        ],
      },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("id_mismatch");
    const after = await Bun.file(filePath).text();
    expect(after).toBe(before);
  });

  test("returns not_found for missing schedule", async () => {
    const result = await scheduleEditTool.execute(
      {
        id: "ghost",
        patches: [{ start_line: 1, end_line: 1, content: "x" }],
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
  });
});
