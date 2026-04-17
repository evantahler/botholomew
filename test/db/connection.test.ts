import { describe, expect, test } from "bun:test";
import { withRetry } from "../../src/db/connection.ts";

const lockError = () => new Error("Conflicting lock is held in bun by user");

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

  test("retries lock-conflict errors and succeeds on later attempt", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) {
        throw lockError();
      }
      return "recovered";
    }, 5);

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  test("throws after exhausting retries on persistent lock conflicts", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw lockError();
      }, 3),
    ).rejects.toThrow(/Conflicting lock/);

    expect(attempts).toBe(3);
  });

  test("does not retry non-lock errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("constraint violation: primary key");
      }),
    ).rejects.toThrow("constraint violation");

    expect(attempts).toBe(1);
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
