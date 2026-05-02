import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { embed, embedSingle } from "../../src/context/embedder-impl.ts";

const config = { ...DEFAULT_CONFIG };

describe("embed", () => {
  test("returns empty array for empty input without loading the model", async () => {
    const vectors = await embed([], config);
    expect(vectors).toHaveLength(0);
  });

  // This test exercises the real @huggingface/transformers pipeline. The
  // first run downloads ~33 MB of model weights to ~/.cache/huggingface/;
  // subsequent runs load from disk in milliseconds.
  test("loads the default model and returns L2-normalized 384-dim vectors", async () => {
    const vectors = await embed(["hello world", "goodbye world"], config);
    expect(vectors).toHaveLength(2);

    const v0 = vectors[0];
    const v1 = vectors[1];
    expect(v0).toHaveLength(384);
    expect(v1).toHaveLength(384);

    // L2 normalization: unit vectors have magnitude ~1
    const mag0 = Math.sqrt((v0 ?? []).reduce((s, x) => s + x * x, 0));
    const mag1 = Math.sqrt((v1 ?? []).reduce((s, x) => s + x * x, 0));
    expect(mag0).toBeCloseTo(1, 4);
    expect(mag1).toBeCloseTo(1, 4);

    // Two related sentences should have positive cosine similarity. Since
    // the vectors are unit-normalized, dot product == cosine similarity.
    const sim = (v0 ?? []).reduce((s, x, i) => s + x * (v1?.[i] ?? 0), 0);
    expect(sim).toBeGreaterThan(0);
  }, 120_000);

  test("embedSingle returns one vector of the configured dimension", async () => {
    const vec = await embedSingle("test", config);
    expect(vec).toHaveLength(384);
  }, 120_000);
});
