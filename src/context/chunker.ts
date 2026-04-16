import Anthropic from "@anthropic-ai/sdk";
import type { BotholomewConfig } from "../config/schemas.ts";

export interface Chunk {
  index: number;
  content: string;
}

const SHORT_CONTENT_THRESHOLD = 200;
const LLM_TIMEOUT_MS = 10_000;
const DEFAULT_OVERLAP_LINES = 2;

const CHUNKER_TOOL_NAME = "return_chunks";
const CHUNKER_TOOL = {
  name: CHUNKER_TOOL_NAME,
  description:
    "Return the chunk boundaries for this document. Each chunk should be a coherent semantic section.",
  input_schema: {
    type: "object" as const,
    properties: {
      chunks: {
        type: "array",
        description: "Array of chunk boundaries (1-based, inclusive)",
        items: {
          type: "object",
          properties: {
            start_line: {
              type: "number",
              description: "1-based start line (inclusive)",
            },
            end_line: {
              type: "number",
              description: "1-based end line (inclusive)",
            },
          },
          required: ["start_line", "end_line"],
        },
      },
    },
    required: ["chunks"],
  },
};

/**
 * Add overlapping lines from the end of each chunk to the start of the next.
 * Improves retrieval when concepts span chunk boundaries.
 */
export function addOverlapToChunks(
  chunks: Chunk[],
  overlapLines = DEFAULT_OVERLAP_LINES,
): Chunk[] {
  if (chunks.length <= 1 || overlapLines <= 0) return chunks;

  return chunks.map((c, i) => {
    if (i === 0) return { ...c };
    const prevChunk = chunks[i - 1];
    if (!prevChunk) return { ...c };
    const prevLines = prevChunk.content.split("\n");
    const overlap = prevLines.slice(-overlapLines).join("\n");
    return { ...c, content: `${overlap}\n${c.content}` };
  });
}

/**
 * LLM-driven chunker that asks Claude to identify semantic boundaries.
 * Uses structured outputs via tool_use with forced tool_choice.
 */
export async function chunkWithLLM(
  content: string,
  mimeType: string,
  config: Required<BotholomewConfig>,
): Promise<Chunk[]> {
  const client = new Anthropic({ apiKey: config.anthropic_api_key });
  const lines = content.split("\n");

  const response = await Promise.race([
    client.messages.create({
      model: config.chunker_model,
      max_tokens: 1024,
      tools: [CHUNKER_TOOL],
      tool_choice: { type: "tool", name: CHUNKER_TOOL_NAME },
      messages: [
        {
          role: "user",
          content: `You are a document chunker. Given the following ${mimeType} document with ${lines.length} lines, identify semantic chunk boundaries. Each chunk should be a coherent section (100-500 lines preferred). Cover all lines with no gaps.

Document:
${content}`,
        },
      ],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("LLM chunker timeout")),
        LLM_TIMEOUT_MS,
      ),
    ),
  ]);

  // Extract the tool_use block
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("LLM chunker returned no tool_use block");
  }

  const input = toolBlock.input as {
    chunks: Array<{ start_line: number; end_line: number }>;
  };

  if (!Array.isArray(input.chunks) || input.chunks.length === 0) {
    throw new Error("LLM chunker returned empty boundaries");
  }

  return input.chunks.map((b, i) => ({
    index: i,
    content: lines.slice(b.start_line - 1, b.end_line).join("\n"),
  }));
}

/**
 * Chunk content using the LLM chunker.
 * Short content (<200 chars) is returned as a single chunk.
 */
export async function chunk(
  content: string,
  mimeType: string,
  config: Required<BotholomewConfig>,
): Promise<Chunk[]> {
  if (content.length < SHORT_CONTENT_THRESHOLD) {
    return [{ index: 0, content }];
  }

  if (!config.anthropic_api_key) {
    throw new Error(
      "Anthropic API key is required for chunking. Set anthropic_api_key in config.",
    );
  }

  const chunks = await chunkWithLLM(content, mimeType, config);
  return addOverlapToChunks(chunks);
}
