import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { logger } from "../utils/logger.ts";

/** Rough estimate: ~4 characters per token for English text */
const CHARS_PER_TOKEN = 4;

/** Fallback if the models API call fails */
const DEFAULT_MAX_INPUT_TOKENS = 200_000;

/** Reserve this fraction of the context window for safety margin */
const HEADROOM_FRACTION = 0.1;

/** Maximum characters for a single tool result before truncation */
const MAX_TOOL_RESULT_CHARS = 50_000;

/** Cache model max_input_tokens to avoid repeated API calls */
const modelTokenCache = new Map<string, number>();

/**
 * Look up the model's max input tokens via the Anthropic Models API.
 * Results are cached per model ID for the lifetime of the process.
 */
export async function getMaxInputTokens(
  apiKey: string | undefined,
  model: string,
): Promise<number> {
  const cached = modelTokenCache.get(model);
  if (cached !== undefined) return cached;

  try {
    const client = new Anthropic({ apiKey: apiKey || undefined });
    const info = await client.beta.models.retrieve(model);
    const limit = info.max_input_tokens ?? DEFAULT_MAX_INPUT_TOKENS;
    modelTokenCache.set(model, limit);
    return limit;
  } catch (err) {
    logger.debug(`Failed to retrieve model info for ${model}: ${err}`);
    modelTokenCache.set(model, DEFAULT_MAX_INPUT_TOKENS);
    return DEFAULT_MAX_INPUT_TOKENS;
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function messageChars(msg: MessageParam): number {
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content)) {
    let total = 0;
    for (const block of msg.content) {
      if ("text" in block && typeof block.text === "string") {
        total += block.text.length;
      } else if ("content" in block && typeof block.content === "string") {
        total += block.content.length;
      } else {
        // tool_use blocks with input, etc.
        total += JSON.stringify(block).length;
      }
    }
    return total;
  }
  return JSON.stringify(msg.content).length;
}

/**
 * Truncate individual tool results that are excessively large.
 * Mutates messages in-place.
 */
function truncateToolResults(messages: MessageParam[]): void {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (
        "type" in block &&
        block.type === "tool_result" &&
        "content" in block &&
        typeof block.content === "string" &&
        block.content.length > MAX_TOOL_RESULT_CHARS
      ) {
        const original = block.content.length;
        (block as { content: string }).content =
          block.content.slice(0, MAX_TOOL_RESULT_CHARS) +
          `\n\n[truncated: ${original} chars → ${MAX_TOOL_RESULT_CHARS} chars]`;
      }
    }
  }
}

/**
 * Ensure the conversation fits within the context window.
 * Strategy:
 * 1. Truncate oversized tool results
 * 2. If still too large, drop oldest assistant/tool pairs from the middle
 *    (keeping the first user message and recent messages)
 *
 * Mutates messages in-place and returns the array.
 */
export function fitToContextWindow(
  messages: MessageParam[],
  systemPrompt: string,
  maxInputTokens: number,
): MessageParam[] {
  // Step 1: truncate oversized tool results
  truncateToolResults(messages);

  // Step 2: estimate total tokens
  const systemTokens = estimateTokens(systemPrompt);
  const responseBuffer = 4096; // max_tokens for the response
  const headroom = Math.ceil(maxInputTokens * HEADROOM_FRACTION);

  const budget = maxInputTokens - systemTokens - responseBuffer - headroom;
  if (budget <= 0) {
    logger.warn(
      `System prompt alone is ~${systemTokens} tokens, very close to the ${maxInputTokens} token limit`,
    );
    return messages;
  }

  let totalChars = messages.reduce((sum, m) => sum + messageChars(m), 0);
  let totalTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);

  if (totalTokens <= budget) {
    return messages;
  }

  // Step 3: drop oldest message pairs from the middle until we fit.
  // Keep messages[0] (initial user message) and remove from index 1 onward.
  let dropped = 0;
  while (totalTokens > budget && messages.length > 2) {
    // Remove the oldest non-first message (index 1)
    const removed = messages.splice(1, 1)[0] as MessageParam;
    totalChars -= messageChars(removed);
    totalTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
    dropped++;
  }

  if (dropped > 0) {
    logger.info(
      `Context window management: dropped ${dropped} older messages to fit within ${maxInputTokens} token budget`,
    );
  }

  return messages;
}
