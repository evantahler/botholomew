import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { CacheTokens } from "./types.ts";

interface AnthropicCacheMeta {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * Normalize cache-token accounting across providers. Anthropic surfaces cache
 * read/creation via `providerMetadata.anthropic`; AI SDK also bubbles cache
 * reads into `usage.inputTokenDetails.cacheReadTokens` for some providers.
 * Non-caching providers (Ollama, OpenAI-compatible) yield zeros.
 */
export function extractCacheTokens(
  usage: LanguageModelUsage | undefined,
  meta?: ProviderMetadata,
): CacheTokens {
  const anthropicMeta = (meta?.anthropic ?? {}) as AnthropicCacheMeta;
  return {
    input: usage?.inputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
    cacheRead:
      anthropicMeta.cacheReadInputTokens ??
      usage?.inputTokenDetails?.cacheReadTokens ??
      usage?.cachedInputTokens ??
      0,
    cacheCreation:
      anthropicMeta.cacheCreationInputTokens ??
      usage?.inputTokenDetails?.cacheWriteTokens ??
      0,
  };
}
