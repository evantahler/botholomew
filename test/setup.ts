import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config/schemas.ts";

// All tests share one model cache so each tempdir-init test doesn't re-download
// the embedding weights (~33 MB). Subprocess tests inherit the env var via
// Bun.spawn({ env: { ...process.env, ... } }), and loadConfig honors the
// override before falling back to <projectDir>/.botholomew/models.
const SHARED_MODELS_DIR = join(tmpdir(), "botholomew-test-models");
mkdirSync(SHARED_MODELS_DIR, { recursive: true });
process.env.BOTHOLOMEW_MODELS_DIR_OVERRIDE = SHARED_MODELS_DIR;

const { setEmbeddingCacheDir, embedSingle } = await import(
  "../src/context/embedder-impl.ts"
);
setEmbeddingCacheDir(SHARED_MODELS_DIR);

const PREWARM_TIMEOUT_MS = 60_000;
await Promise.race([
  embedSingle("warmup", { ...DEFAULT_CONFIG, anthropic_api_key: "test" }),
  new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `Embedding model prewarm timed out after ${PREWARM_TIMEOUT_MS / 1000}s`,
          ),
        ),
      PREWARM_TIMEOUT_MS,
    ),
  ),
]);
