import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  env,
  type FeatureExtractionPipeline,
  pipeline,
} from "@huggingface/transformers";
import type { BotholomewConfig } from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";

// We patch @huggingface/transformers to use onnxruntime-web (WASM) instead of
// onnxruntime-node (which segfaults under Bun — oven-sh/bun#26081). By default
// transformers.js then points the WASM loader at jsDelivr; pin it to the
// onnxruntime-web copy already on disk so the chat path stays offline-capable.
const ortWasm = env.backends.onnx?.wasm;
if (ortWasm) {
  ortWasm.wasmPaths = {
    mjs: import.meta.resolve(
      "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs",
    ),
    wasm: import.meta.resolve(
      "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm",
    ),
  };
}

type EmbedFn = (
  texts: string[],
  config: Required<BotholomewConfig>,
) => Promise<number[][]>;

// Singleton pipeline keyed by model name. Loading the model is expensive
// (downloads weights on first run, then ~hundreds of ms to instantiate the
// ONNX runtime), so we hold one per model for the life of the process.
const pipelinePromises = new Map<string, Promise<FeatureExtractionPipeline>>();

export function setEmbeddingCacheDir(dir: string): void {
  // Trailing separator matters: transformers.js builds paths as `${cacheDir}${rel}` (no separator).
  env.cacheDir = dir.endsWith("/") ? dir : `${dir}/`;
}

function isModelCached(model: string): boolean {
  if (!env.cacheDir) return false;
  return existsSync(join(env.cacheDir, model));
}

async function getPipeline(model: string): Promise<FeatureExtractionPipeline> {
  let p = pipelinePromises.get(model);
  if (!p) {
    logger.info(
      isModelCached(model)
        ? `Loading embedding model ${model}`
        : `Loading embedding model ${model} (first run, downloading weights)`,
    );
    p = pipeline("feature-extraction", model);
    pipelinePromises.set(model, p);
  }
  return p;
}

/**
 * Embed multiple texts using a local @huggingface/transformers feature-extraction
 * pipeline. Returns an array of L2-normalized float vectors with the model's
 * native dimension (must match `config.embedding_dimension`).
 */
export async function embed(
  texts: string[],
  config: Required<BotholomewConfig>,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor = await getPipeline(config.embedding_model);
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const data = output.tolist() as number[][];

  if (data[0] && data[0].length !== config.embedding_dimension) {
    throw new Error(
      `Embedding model ${config.embedding_model} returned ${data[0].length}-dim vectors, but embedding_dimension is set to ${config.embedding_dimension}. Update embedding_dimension in config and re-embed.`,
    );
  }

  return data;
}

/**
 * Embed a single text string.
 */
export async function embedSingle(
  text: string,
  config: Required<BotholomewConfig>,
): Promise<number[]> {
  const results = await embed([text], config);
  const vec = results[0];
  if (!vec) throw new Error("embed returned empty results");
  return vec;
}

export type { EmbedFn };
