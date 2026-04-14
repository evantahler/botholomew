import {
  EMBEDDING_DIMENSION,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
} from "../constants.ts";

type EmbedFn = (texts: string[]) => Promise<number[][]>;

let pipelineInstance: ReturnType<typeof createPipelinePromise> | null = null;

function createPipelinePromise() {
  return (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
      dtype: EMBEDDING_DTYPE,
    });
    return pipe;
  })();
}

async function getEmbeddingPipeline() {
  if (!pipelineInstance) {
    pipelineInstance = createPipelinePromise();
  }
  return pipelineInstance;
}

/**
 * Ensure the embedding model is downloaded and loaded.
 * Call at application boot (daemon start, CLI commands that need embeddings).
 * Downloads the model on first run (~33MB).
 */
export async function warmupEmbedder(): Promise<void> {
  await getEmbeddingPipeline();
}

/**
 * Embed multiple texts using the local BGE model.
 * Returns an array of 384-dimensional float vectors.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const pipe = await getEmbeddingPipeline();
  const output = await pipe(texts, { pooling: "cls", normalize: true });

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const row = (output as { data: Float32Array }).data.slice(
      i * EMBEDDING_DIMENSION,
      (i + 1) * EMBEDDING_DIMENSION,
    );
    results.push(Array.from(row));
  }
  return results;
}

/**
 * Embed a single text string.
 */
export async function embedSingle(text: string): Promise<number[]> {
  const results = await embed([text]);
  const vec = results[0];
  if (!vec) throw new Error("embed returned empty results");
  return vec;
}

/**
 * Reset the singleton pipeline (for testing).
 */
export function resetEmbedder(): void {
  pipelineInstance = null;
}

export type { EmbedFn };
