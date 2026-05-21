import type { ModelMessage } from "ai";
import type { LlmBlock } from "../config/schemas.ts";
import { getMaxInputTokens as llmGetMaxInputTokens } from "../llm/index.ts";
import { logger } from "../utils/logger.ts";

/** Rough estimate: ~4 characters per token for English text */
const CHARS_PER_TOKEN = 4;

/** Reserve this fraction of the context window for safety margin */
const HEADROOM_FRACTION = 0.1;

/** Maximum characters for a single tool result before truncation */
const MAX_TOOL_RESULT_CHARS = 50_000;

/** Re-export so call sites have a single entry point. */
export function getMaxInputTokens(cfg: LlmBlock): Promise<number> {
  return llmGetMaxInputTokens(cfg);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function messageChars(msg: ModelMessage): number {
  if (typeof msg.content === "string") return msg.content.length;
  if (!Array.isArray(msg.content)) return 0;
  let total = 0;
  for (const block of msg.content) {
    const b = block as Record<string, unknown>;
    if (typeof b.text === "string") {
      total += b.text.length;
    } else if (b.type === "tool-result" && typeof b.output === "object") {
      const out = b.output as { value?: unknown };
      total +=
        typeof out.value === "string"
          ? out.value.length
          : JSON.stringify(out.value ?? "").length;
    } else {
      total += JSON.stringify(b).length;
    }
  }
  return total;
}

/**
 * Truncate individual tool results that are excessively large. Mutates in-place.
 */
function truncateToolResults(messages: ModelMessage[]): void {
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      const b = block as {
        type?: string;
        output?: { type?: string; value?: unknown };
      };
      if (b.type !== "tool-result" || !b.output) continue;
      const out = b.output;
      if (typeof out.value !== "string") continue;
      if (out.value.length <= MAX_TOOL_RESULT_CHARS) continue;
      const original = out.value.length;
      out.value =
        out.value.slice(0, MAX_TOOL_RESULT_CHARS) +
        `\n\n[truncated: ${original} chars → ${MAX_TOOL_RESULT_CHARS} chars]`;
    }
  }
}

/**
 * Ensure the conversation fits within the context window.
 * 1) Truncate oversized tool results in place.
 * 2) If still too large, drop oldest messages from the middle (keeping the
 *    first user message and recent messages).
 */
export function fitToContextWindow(
  messages: ModelMessage[],
  systemPrompt: string,
  maxInputTokens: number,
): ModelMessage[] {
  truncateToolResults(messages);

  const systemTokens = estimateTokens(systemPrompt);
  const responseBuffer = 4096;
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

  if (totalTokens <= budget) return messages;

  let dropped = 0;
  while (totalTokens > budget && messages.length > 2) {
    const removed = messages.splice(1, 1)[0] as ModelMessage;
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
