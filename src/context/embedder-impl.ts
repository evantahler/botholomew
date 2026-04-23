import type { BotholomewConfig } from "../config/schemas.ts";

type EmbedFn = (
  texts: string[],
  config: Required<BotholomewConfig>,
) => Promise<number[][]>;

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  usage: { total_tokens: number };
}

/**
 * Embed multiple texts using the OpenAI embeddings API.
 * Returns an array of float vectors with the configured dimension.
 */
export async function embed(
  texts: string[],
  config: Required<BotholomewConfig>,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (!config.openai_api_key) {
    throw new Error(
      "OpenAI API key is required for embeddings. Set openai_api_key in config or OPENAI_API_KEY env var.",
    );
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openai_api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: config.embedding_model,
      dimensions: config.embedding_dimension,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI embeddings API error (${response.status}): ${body}`,
    );
  }

  const result = (await response.json()) as OpenAIEmbeddingResponse;

  // Sort by index to ensure order matches input
  const sorted = result.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
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
