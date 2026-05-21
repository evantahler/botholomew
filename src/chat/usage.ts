import type { ModelMessage } from "ai";

/** Rough estimate: ~4 characters per token. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate of where the prompt's bytes went on the most recent assistant
 * turn. The five categories sum to roughly the server-billed input-tokens
 * total — they're estimates derived from string length / 4.
 */
export interface ContextBreakdown {
  /** Files loaded from `prompts/` (always-on plus any contextual matches). */
  prompts: number;
  /** Chat instructions block + MCP guidance + style rules + meta header. */
  instructions: number;
  /** Tool schemas (chat-allowed tools + MCP meta-tools). */
  tools: number;
  /** User and assistant text in the conversation history. */
  messages: number;
  /** `tool-call` and `tool-result` parts accumulated during the conversation. */
  toolIo: number;
}

export interface ContextUsage {
  /** Prompt tokens billed by the server (input + cache_read + cache_creation). */
  used: number;
  /** Model's max input tokens. */
  max: number;
  /** Local estimates per section. */
  breakdown: ContextBreakdown;
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Walk a `messages` array and split chars into plain text vs. tool I/O. */
export function partitionMessages(messages: ModelMessage[]): {
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
    for (const part of msg.content) {
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") {
        textChars += p.text.length;
      } else if (p.type === "tool-call") {
        toolIoChars += JSON.stringify(p).length;
      } else if (p.type === "tool-result") {
        const out = p.output as { value?: unknown } | undefined;
        toolIoChars +=
          typeof out?.value === "string"
            ? out.value.length
            : JSON.stringify(out ?? "").length;
      } else {
        textChars += JSON.stringify(p).length;
      }
    }
  }
  return { textChars, toolIoChars };
}
