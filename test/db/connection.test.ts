import { describe, expect, test } from "bun:test";
import { withRetry } from "../../src/db/connection.ts";

describe("withRetry", () => {
  test("returns immediately on first success", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  test("retries on SQLITE_BUSY and succeeds on later attempt", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("SQLITE_BUSY");
      }
      return "recovered";
    }, 5);

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  test("retries on 'database is locked' message", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error("database is locked");
      }
      return "unlocked";
    }, 3);

    expect(result).toBe("unlocked");
    expect(attempts).toBe(2);
  });

  test("throws after exhausting all retries on SQLITE_BUSY", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("SQLITE_BUSY");
      }, 3),
    ).rejects.toThrow("SQLITE_BUSY");

    expect(attempts).toBe(3);
  });

  test("throws immediately on non-SQLITE_BUSY errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("UNIQUE constraint failed");
      }, 5),
    ).rejects.toThrow("UNIQUE constraint failed");

    expect(attempts).toBe(1);
  });

  test("throws non-Error values immediately", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw "string error";
      }, 5),
    ).rejects.toThrow();

    expect(attempts).toBe(1);
  });

  test("uses default maxRetries of 5", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("SQLITE_BUSY");
      }),
    ).rejects.toThrow("SQLITE_BUSY");

    expect(attempts).toBe(5);
  });

  test("works with async functions that return different types", async () => {
    const numResult = await withRetry(async () => 42);
    expect(numResult).toBe(42);

    const objResult = await withRetry(async () => ({ key: "value" }));
    expect(objResult).toEqual({ key: "value" });

    const arrResult = await withRetry(async () => [1, 2, 3]);
    expect(arrResult).toEqual([1, 2, 3]);
  });
});
