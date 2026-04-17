import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  markScheduleRun,
  updateSchedule,
} from "../../src/db/schedules.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

describe("schedule CRUD", () => {
  test("create and get a schedule", async () => {
    const schedule = await createSchedule(conn, {
      name: "Morning email",
      description: "Check email and summarize",
      frequency: "every morning",
    });

    expect(schedule.name).toBe("Morning email");
    expect(schedule.description).toBe("Check email and summarize");
    expect(schedule.frequency).toBe("every morning");
    expect(schedule.enabled).toBe(true);
    expect(schedule.last_run_at).toBeNull();
    expect(schedule.id).toBeTruthy();

    const fetched = await getSchedule(conn, schedule.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("Morning email");
  });

  test("create schedule with default description", async () => {
    const schedule = await createSchedule(conn, {
      name: "Test",
      frequency: "daily",
    });
    expect(schedule.description).toBe("");
  });

  test("get nonexistent schedule returns null", async () => {
    const schedule = await getSchedule(conn, "nonexistent");
    expect(schedule).toBeNull();
  });

  test("list all schedules", async () => {
    await createSchedule(conn, { name: "A", frequency: "daily" });
    await createSchedule(conn, { name: "B", frequency: "weekly" });

    const schedules = await listSchedules(conn);
    expect(schedules.length).toBe(2);
    expect(schedules[0]?.name).toBe("A");
    expect(schedules[1]?.name).toBe("B");
  });

  test("list schedules with limit and offset", async () => {
    await createSchedule(conn, { name: "A", frequency: "daily" });
    await createSchedule(conn, { name: "B", frequency: "daily" });
    await createSchedule(conn, { name: "C", frequency: "daily" });
    await createSchedule(conn, { name: "D", frequency: "daily" });

    const page = await listSchedules(conn, { limit: 2, offset: 1 });
    expect(page.length).toBe(2);
    expect(page[0]?.name).toBe("B");
    expect(page[1]?.name).toBe("C");
  });

  test("list schedules filtered by enabled", async () => {
    const s = await createSchedule(conn, {
      name: "Active",
      frequency: "daily",
    });
    await createSchedule(conn, { name: "Inactive", frequency: "daily" });
    await updateSchedule(conn, s.id, { enabled: false });

    const enabled = await listSchedules(conn, { enabled: true });
    expect(enabled.length).toBe(1);
    expect(enabled[0]?.name).toBe("Inactive");

    const disabled = await listSchedules(conn, { enabled: false });
    expect(disabled.length).toBe(1);
    expect(disabled[0]?.name).toBe("Active");
  });

  test("update schedule fields", async () => {
    const schedule = await createSchedule(conn, {
      name: "Original",
      frequency: "daily",
    });

    const updated = await updateSchedule(conn, schedule.id, {
      name: "Updated",
      frequency: "weekly",
      description: "New description",
    });

    expect(updated?.name).toBe("Updated");
    expect(updated?.frequency).toBe("weekly");
    expect(updated?.description).toBe("New description");
  });

  test("update with empty updates returns current", async () => {
    const schedule = await createSchedule(conn, {
      name: "Test",
      frequency: "daily",
    });

    const same = await updateSchedule(conn, schedule.id, {});
    expect(same?.name).toBe("Test");
  });

  test("update nonexistent schedule returns null", async () => {
    const result = await updateSchedule(conn, "nonexistent", { name: "X" });
    expect(result).toBeNull();
  });

  test("delete schedule", async () => {
    const schedule = await createSchedule(conn, {
      name: "To delete",
      frequency: "daily",
    });

    const deleted = await deleteSchedule(conn, schedule.id);
    expect(deleted).toBe(true);

    const fetched = await getSchedule(conn, schedule.id);
    expect(fetched).toBeNull();
  });

  test("delete nonexistent schedule returns false", async () => {
    const deleted = await deleteSchedule(conn, "nonexistent");
    expect(deleted).toBe(false);
  });

  test("markScheduleRun updates last_run_at", async () => {
    const schedule = await createSchedule(conn, {
      name: "Test",
      frequency: "daily",
    });
    expect(schedule.last_run_at).toBeNull();

    await markScheduleRun(conn, schedule.id);

    const updated = await getSchedule(conn, schedule.id);
    expect(updated?.last_run_at).not.toBeNull();
    expect(updated?.last_run_at).toBeInstanceOf(Date);
  });
});
