import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { chunk, chunkWithSlidingWindow } from "../../src/context/chunker.ts";

describe("chunkWithSlidingWindow", () => {
  test("returns single chunk for short content", () => {
    const content = "Hello world, this is short.";
    const chunks = chunkWithSlidingWindow(content, 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.content).toBe(content);
  });

  test("splits long content into overlapping chunks", () => {
    // Create content that's definitely longer than the window
    const lines = Array.from(
      { length: 100 },
      (_, i) => `Line ${i + 1}: ${"x".repeat(30)}`,
    );
    const content = lines.join("\n");
    const chunks = chunkWithSlidingWindow(content, 500, 100);

    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should be within the window size (roughly)
    for (const c of chunks) {
      expect(c?.content.length).toBeLessThanOrEqual(600); // some slack for newline breaking
    }

    // Indices should be sequential
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]?.index).toBe(i);
    }
  });

  test("all content is covered", () => {
    const content = "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ";
    const chunks = chunkWithSlidingWindow(content, 5, 2);

    // Every character in the original should appear in at least one chunk
    for (const char of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
      const found = chunks.some((c) => c.content.includes(char));
      expect(found).toBe(true);
    }
  });

  test("prefers breaking at newlines", () => {
    const content = "First line\nSecond line\nThird line\nFourth line";
    const chunks = chunkWithSlidingWindow(content, 25, 5);

    // Chunks should end at newline boundaries when possible
    for (const c of chunks.slice(0, -1)) {
      // Non-last chunks should end with newline or be at a line boundary
      expect(c.content.endsWith("\n") || c.content.endsWith("line")).toBe(true);
    }
  });
});

describe("chunk", () => {
  test("returns single chunk for short content", async () => {
    const config = { ...DEFAULT_CONFIG };
    const chunks = await chunk("Hi", "text/plain", config);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe("Hi");
  });

  test("falls back to sliding window without API key", async () => {
    const config = { ...DEFAULT_CONFIG, anthropic_api_key: "" };
    const content = "x".repeat(3000);
    const chunks = await chunk(content, "text/plain", config);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
