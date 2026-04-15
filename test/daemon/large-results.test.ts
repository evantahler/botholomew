import { beforeEach, describe, expect, it } from "bun:test";
import {
  clearLargeResults,
  MAX_INLINE_CHARS,
  maybeStoreResult,
  PAGE_SIZE_CHARS,
  readLargeResultPage,
  storeLargeResult,
} from "../../src/daemon/large-results.ts";

describe("large-results store", () => {
  beforeEach(() => {
    clearLargeResults();
  });

  describe("storeLargeResult / readLargeResultPage", () => {
    it("stores content and returns a valid id", () => {
      const id = storeLargeResult("test_tool", "hello world");
      expect(id).toMatch(/^lr_\d+$/);
    });

    it("reads back page 1 correctly", () => {
      const content = "x".repeat(PAGE_SIZE_CHARS * 2 + 100);
      const id = storeLargeResult("test_tool", content);

      const page1 = readLargeResultPage(id, 1);
      expect(page1).not.toBeNull();
      expect(page1?.page).toBe(1);
      expect(page1?.totalPages).toBe(3);
      expect(page1?.content.length).toBe(PAGE_SIZE_CHARS);
    });

    it("reads the last page which may be shorter", () => {
      const content = "x".repeat(PAGE_SIZE_CHARS + 100);
      const id = storeLargeResult("test_tool", content);

      const page2 = readLargeResultPage(id, 2);
      expect(page2).not.toBeNull();
      expect(page2?.page).toBe(2);
      expect(page2?.content.length).toBe(100);
    });

    it("returns null for invalid id", () => {
      expect(readLargeResultPage("lr_999", 1)).toBeNull();
    });

    it("returns null for out-of-range page", () => {
      const id = storeLargeResult("test_tool", "short");
      expect(readLargeResultPage(id, 2)).toBeNull();
    });
  });

  describe("maybeStoreResult", () => {
    it("returns small results unchanged", () => {
      const small = "x".repeat(100);
      expect(maybeStoreResult("test_tool", small)).toBe(small);
    });

    it("returns results at exactly MAX_INLINE_CHARS unchanged", () => {
      const exact = "x".repeat(MAX_INLINE_CHARS);
      expect(maybeStoreResult("test_tool", exact)).toBe(exact);
    });

    it("stores results exceeding MAX_INLINE_CHARS and returns a stub", () => {
      const big = "x".repeat(MAX_INLINE_CHARS + 1);
      const result = maybeStoreResult("my_tool", big);

      expect(result).toContain("[Large result from my_tool");
      expect(result).toContain("read_large_result");
      expect(result.length).toBeLessThan(big.length);
    });

    it("stub includes a preview of the content", () => {
      const big = `HELLO_PREFIX${"x".repeat(MAX_INLINE_CHARS)}`;
      const result = maybeStoreResult("my_tool", big);
      expect(result).toContain("HELLO_PREFIX");
    });

    it("stored result is readable via readLargeResultPage", () => {
      const big = "abcdef".repeat(5000);
      const stub = maybeStoreResult("my_tool", big);

      // Extract the id from the stub
      const match = stub.match(/lr_\d+/);
      expect(match).not.toBeNull();
      const id = match?.[0] ?? "";

      const page1 = readLargeResultPage(id, 1);
      expect(page1).not.toBeNull();
      expect(page1?.content).toBe(big.slice(0, PAGE_SIZE_CHARS));
    });
  });

  describe("clearLargeResults", () => {
    it("clears all stored results", () => {
      const id = storeLargeResult("test_tool", "some content");
      expect(readLargeResultPage(id, 1)).not.toBeNull();

      clearLargeResults();
      expect(readLargeResultPage(id, 1)).toBeNull();
    });
  });
});
