import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { embed } from "../../src/context/embedder-impl.ts";

const config = { ...DEFAULT_CONFIG };

describe("embed", () => {
  test("returns empty array for empty input without loading the model", async () => {
    // The empty-input fast path is the only embedder behaviour we can verify
    // without downloading model weights — exercising the real pipeline in CI
    // would pull ~30MB of ONNX weights on every run. The actual model wiring
    // is exercised by `botholomew prepare` and the integration tests under
    // test/commands/ which use mocked embedders.
    const vectors = await embed([], config);
    expect(vectors).toHaveLength(0);
  });
});
