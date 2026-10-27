import type { ModelMessage, SystemModelMessage, ToolSet } from "ai";
import type { LlmBlock } from "../config/schemas.ts";

const EPHEMERAL = { type: "ephemeral" as const };

/**
 * On Anthropic, mark stable parts of the request with `cacheControl: ephemeral`
 * so the server can cache the prompt prefix between turns. No-op for other
 * providers — they receive unchanged inputs.
 *
 * - System prompt: passed as a single SystemModelMessage with cacheControl.
 * - Messages: the last assistant message is marked as a cache breakpoint so the
 *   conversation prefix up to (and including) it is cached on the next turn.
 */
export function withAnthropicCacheBreakpoints<T extends ToolSet>(args: {
  provider: LlmBlock["provider"];
  system: string;
  messages: ModelMessage[];
  tools: T;
}): {
  system: string | SystemModelMessage;
  messages: ModelMessage[];
  tools: T;
} {
  if (args.provider !== "anthropic") {
    return {
      system: args.system,
      messages: args.messages,
      tools: args.tools,
    };
  }

  const systemMessage: SystemModelMessage = {
    role: "system",
    content: args.system,
    providerOptions: { anthropic: { cacheControl: EPHEMERAL } },
  };

  // Find the index of the last assistant message; mark it as the cache
  // breakpoint. The Anthropic API caches up to and including that block.
  let lastAssistantIdx = -1;
  for (let i = args.messages.length - 1; i >= 0; i--) {
    if (args.messages[i]?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  const messages = args.messages.map((m, i) => {
    if (i !== lastAssistantIdx) return m;
    return {
      ...m,
      providerOptions: {
        ...(m.providerOptions ?? {}),
        anthropic: { cacheControl: EPHEMERAL },
      },
    };
  });

  return {
    system: systemMessage,
    messages,
    tools: args.tools,
  };
}
