import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

/** Rough Anthropic-style estimate: ~4 characters per token. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate of where the prompt's bytes went on the most recent assistant
 * turn. The five categories sum to roughly the server-billed input-tokens
 * total — they're estimates derived from string length / 4, so they don't
 * line up exactly with the API's count.
 */
export interface ContextBreakdown {
  /** Persistent context files from `prompts/` (soul, beliefs, goals, capabilities, contextual). */
  prompts: number;
  /** Chat instructions block + MCP guidance + style rules + meta header. */
  instructions: number;
  /** Anthropic tool schemas (chat-allowed tools + MCP meta-tools). */
  tools: number;
  /** User and assistant text in the conversation history. */
  messages: number;
  /** `tool_use` and `tool_result` blocks accumulated during the conversation. */
  toolIo: number;
}

export interface ContextUsage {
  /** Prompt tokens billed by the server (input + cache_read + cache_creation). */
  used: number;
  /** Model's max input tokens (from the Anthropic Models API). */
  max: number;
  /** Local estimates per section. */
  breakdown: ContextBreakdown;
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Walk a `messages` array and split chars into plain text vs. tool I/O. */
export function partitionMessages(messages: MessageParam[]): {
  textChars: number;
  toolIoChars: number;
} {
  let textChars = 0;
  let toolIoChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      textChars += msg.content.length;
      continue;
    }
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (!("type" in block)) continue;
      if (block.type === "text") {
        textChars += block.text.length;
      } else if (block.type === "tool_use") {
        toolIoChars += JSON.stringify(block).length;
      } else if (block.type === "tool_result") {
        toolIoChars +=
          typeof block.content === "string"
            ? block.content.length
            : JSON.stringify(block.content).length;
      } else {
        // image, document, etc. — count under text for now.
        textChars += JSON.stringify(block).length;
      }
    }
  }
  return { textChars, toolIoChars };
}
