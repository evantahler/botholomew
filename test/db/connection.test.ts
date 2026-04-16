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

  test("retries on transient errors and succeeds on later attempt", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("transient error");
      }
      return "recovered";
    }, 5);

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  test("throws after exhausting all retries", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("persistent error");
      }, 3),
    ).rejects.toThrow("persistent error");

    expect(attempts).toBe(3);
  });

  test("uses default maxRetries of 5", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("always fails");
      }),
    ).rejects.toThrow("always fails");

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
