import { describe, expect, test } from "bun:test";
import { chunk } from "../../src/tui/components/LinkPicker.tsx";

describe("chunk", () => {
  test("splits a long URL into fixed-width slices that rejoin exactly", () => {
    const url = `https://example.com/?${"x".repeat(200)}`;
    const parts = chunk(url, 40);
    expect(parts.join("")).toBe(url);
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(40);
  });

  test("short text is a single chunk", () => {
    expect(chunk("https://a.example", 40)).toEqual(["https://a.example"]);
  });

  test("non-positive width degrades to one line", () => {
    expect(chunk("abc", 0)).toEqual(["abc"]);
  });

  test("empty text still yields one renderable line", () => {
    expect(chunk("", 10)).toEqual([""]);
  });
});
