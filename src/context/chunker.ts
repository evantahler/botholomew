import Anthropic from "@anthropic-ai/sdk";
import type { BotholomewConfig } from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";

export interface Chunk {
  index: number;
  content: string;
}

const DEFAULT_WINDOW_CHARS = 2000;
const DEFAULT_OVERLAP_CHARS = 200;
const SHORT_CONTENT_THRESHOLD = 200;
const LLM_TIMEOUT_MS = 10_000;

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
 * Deterministic sliding-window chunker.
 * Splits content into overlapping windows of approximately `windowChars` characters,
 * breaking at newlines when possible.
 */
export function chunkWithSlidingWindow(
  content: string,
  windowChars = DEFAULT_WINDOW_CHARS,
  overlapChars = DEFAULT_OVERLAP_CHARS,
): Chunk[] {
  if (content.length <= windowChars) {
    return [{ index: 0, content }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < content.length) {
    let end = Math.min(start + windowChars, content.length);

    // Try to break at a newline near the end of the window
    if (end < content.length) {
      const lastNewline = content.lastIndexOf("\n", end);
      if (lastNewline > start + windowChars / 2) {
        end = lastNewline + 1;
      }
    }

    chunks.push({ index, content: content.slice(start, end) });
    index++;

    if (end >= content.length) break;
    start = end - overlapChars;
  }

  return chunks;
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
 * Chunk content using LLM when possible, falling back to sliding window.
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

  // Only try LLM chunking if we have an API key
  if (config.anthropic_api_key) {
    try {
      return await chunkWithLLM(content, mimeType, config);
    } catch (err) {
      logger.debug(`LLM chunking failed, using sliding window: ${err}`);
    }
  }

  return chunkWithSlidingWindow(content);
}
