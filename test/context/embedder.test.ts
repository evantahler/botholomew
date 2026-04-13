import { describe, expect, test } from "bun:test";
import { embed, embedSingle } from "../../src/context/embedder.ts";

// These tests use the real model — they're slow on first run (~2s model load)
// but fast on subsequent runs due to singleton caching.

describe("embed", () => {
  test("returns vectors of correct dimension", async () => {
    const texts = ["hello world", "how are you"];
    const vectors = await embed(texts);

    expect(vectors).toHaveLength(2);
    const [v0, v1] = vectors;
    expect(v0).toHaveLength(384);
    expect(v1).toHaveLength(384);
  });

  test("returns empty array for empty input", async () => {
    const vectors = await embed([]);
    expect(vectors).toHaveLength(0);
  });

  test("vectors are approximately normalized", async () => {
    const results = await embed(["test normalization"]);
    const [vec] = results;
    expect(vec).toBeDefined();
    const norm = Math.sqrt((vec ?? []).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 1);
  });
});

describe("embedSingle", () => {
  test("returns a single vector of correct dimension", async () => {
    const vec = await embedSingle("single text");
    expect(vec).toHaveLength(384);
  });

  test("similar texts produce similar vectors", async () => {
    const v1: number[] = await embedSingle("the cat sat on the mat");
    const v2: number[] = await embedSingle("a cat was sitting on a mat");
    const v3: number[] = await embedSingle("quantum physics equations");

    // Cosine similarity between similar texts should be higher
    const sim12 = cosineSimilarity(v1, v2);
    const sim13 = cosineSimilarity(v1, v3);

    expect(sim12).toBeGreaterThan(sim13);
  });
});

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [i, aVal] of a.entries()) {
    const bVal = b[i] ?? 0;
    dot += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
