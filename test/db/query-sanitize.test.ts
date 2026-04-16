import { describe, expect, test } from "bun:test";
import { sanitizeInt } from "../../src/db/query.ts";

describe("sanitizeInt", () => {
  test("valid positive integers pass through", () => {
    expect(sanitizeInt(1)).toBe(1);
    expect(sanitizeInt(10)).toBe(10);
    expect(sanitizeInt(100)).toBe(100);
    expect(sanitizeInt(999999)).toBe(999999);
  });

  test("zero throws", () => {
    expect(() => sanitizeInt(0)).toThrow("Expected a positive integer");
  });

  test("negative numbers throw", () => {
    expect(() => sanitizeInt(-1)).toThrow("Expected a positive integer");
    expect(() => sanitizeInt(-100)).toThrow("Expected a positive integer");
  });

  test("non-integers throw", () => {
    expect(() => sanitizeInt(1.5)).toThrow("Expected a positive integer");
    expect(() => sanitizeInt(0.1)).toThrow("Expected a positive integer");
  });

  test("NaN throws", () => {
    expect(() => sanitizeInt(NaN)).toThrow("Expected a positive integer");
  });

  test("Infinity throws", () => {
    expect(() => sanitizeInt(Infinity)).toThrow("Expected a positive integer");
    expect(() => sanitizeInt(-Infinity)).toThrow("Expected a positive integer");
  });

  test("returns the validated number", () => {
    const result = sanitizeInt(42);
    expect(result).toBe(42);
    expect(typeof result).toBe("number");
  });
});
