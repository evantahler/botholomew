import { tmpdir } from "node:os";
import { join } from "node:path";
import { setEmbeddingCacheDir } from "membot";

// Redirect transformers' model-weights cache so the suite reuses one copy of
// the embedding model instead of re-downloading it. `MEMBOT_MODEL_CACHE_DIR`
// (set in CI to an actions/cache-restored dir) overrides this default; locally
// it's a throwaway dir. Weights are identical regardless of directory, so a
// single global call here covers every test — the per-test temp dirs from
// setupTestMembot only isolate the DuckDB store.
//
// Without this, every embedder-touching test fetches Xenova/bge-small-en-v1.5
// from HuggingFace, and CI's shared runner IP trips HF's 429 rate limit.
setEmbeddingCacheDir(join(tmpdir(), "botholomew-test-models"));
