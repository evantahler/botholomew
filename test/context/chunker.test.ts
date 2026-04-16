import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { addOverlapToChunks, chunk } from "../../src/context/chunker.ts";

describe("chunk", () => {
  test("returns single chunk for short content", async () => {
    const config = { ...DEFAULT_CONFIG };
    const chunks = await chunk("Hi", "text/plain", config);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe("Hi");
  });

  test("throws when anthropic API key is missing", async () => {
    const config = { ...DEFAULT_CONFIG, anthropic_api_key: "" };
    const content = "x".repeat(300);
    await expect(chunk(content, "text/plain", config)).rejects.toThrow(
      "Anthropic API key is required",
    );
  });
});

describe("addOverlapToChunks", () => {
  test("does not modify a single chunk", () => {
    const chunks = [{ index: 0, content: "line1\nline2\nline3" }];
    const result = addOverlapToChunks(chunks);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe("line1\nline2\nline3");
  });

  test("prepends last N lines of previous chunk to next chunk", () => {
    const chunks = [
      { index: 0, content: "a1\na2\na3\na4" },
      { index: 1, content: "b1\nb2\nb3" },
      { index: 2, content: "c1\nc2" },
    ];
    const result = addOverlapToChunks(chunks, 2);

    expect(result[0]?.content).toBe("a1\na2\na3\na4");
    expect(result[1]?.content).toBe("a3\na4\nb1\nb2\nb3");
    expect(result[2]?.content).toBe("b2\nb3\nc1\nc2");
  });

  test("handles chunks with fewer lines than overlap", () => {
    const chunks = [
      { index: 0, content: "only-one-line" },
      { index: 1, content: "second chunk" },
    ];
    const result = addOverlapToChunks(chunks, 3);

    // Previous chunk has 1 line, overlap requests 3 — just uses what's available
    expect(result[1]?.content).toBe("only-one-line\nsecond chunk");
  });

  test("returns new array without mutating input", () => {
    const chunks = [
      { index: 0, content: "a\nb\nc" },
      { index: 1, content: "d\ne" },
    ];
    const originalContent = chunks[1]?.content;
    const result = addOverlapToChunks(chunks, 2);

    expect(result[1]?.content).not.toBe(originalContent);
    expect(chunks[1]?.content).toBe(originalContent);
  });

  test("returns chunks unchanged when overlapLines is 0", () => {
    const chunks = [
      { index: 0, content: "a\nb" },
      { index: 1, content: "c\nd" },
    ];
    const result = addOverlapToChunks(chunks, 0);
    expect(result[1]?.content).toBe("c\nd");
  });
});
