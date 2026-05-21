import type { LlmBlock } from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";
import { BotholomewLlmError } from "./types.ts";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** Manually-curated max input tokens per known model. */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  "claude-opus-4-6": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  // Ollama (defaults — extendable per Modelfile)
  "llama3.1:8b": 128_000,
  "llama3.1:70b": 128_000,
  "qwen2.5:7b": 32_000,
  "qwen2.5:3b": 32_000,
  "mistral-nemo": 128_000,
};

const FALLBACK_BY_PROVIDER: Record<LlmBlock["provider"], number> = {
  anthropic: 200_000,
  // Ollama allocates KV cache up front, so a generous default eats RAM on
  // local machines. 16K covers Botholomew's system prompt + tool schemas +
  // a reasonable conversation; raise via `llm.max_input_tokens` if needed.
  ollama: 16_000,
  "openai-compatible": 32_000,
};

const tokenCache = new Map<string, number>();
const toolSupportCache = new Map<string, boolean>();

const TOOL_CAPABLE_HINT = `Try one of these tool-capable models:
  Anthropic:           claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5
  Ollama (local):      llama3.1:8b, qwen2.5:7b, mistral-nemo, command-r
  OpenAI-compatible:   gpt-4o, gpt-4o-mini, or any function-calling model

Update \`llm.model\` in your botholomew config. If you believe this model
*does* support tools but the probe is wrong, set \`llm.supports_tools: true\`
to override.`;

function cacheKey(cfg: LlmBlock): string {
  return `${cfg.provider}:${cfg.model}:${cfg.base_url ?? ""}`;
}

function ollamaBaseUrl(cfg: LlmBlock): string {
  return (cfg.base_url || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
}

interface OllamaShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

async function ollamaShow(cfg: LlmBlock): Promise<OllamaShowResponse | null> {
  try {
    const response = await fetch(`${ollamaBaseUrl(cfg)}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model }),
    });
    if (!response.ok) return null;
    return (await response.json()) as OllamaShowResponse;
  } catch (err) {
    logger.debug(`Ollama /api/show failed: ${err}`);
    return null;
  }
}

/**
 * Throws `BotholomewLlmError("no_tool_support", ...)` if the configured model
 * cannot call tools. Memoized per `provider:model:base_url`.
 */
export async function assertToolCapable(cfg: LlmBlock): Promise<void> {
  const key = cacheKey(cfg);
  const cached = toolSupportCache.get(key);
  if (cached === true) return;
  if (cached === false) {
    throw makeNoToolError(cfg);
  }

  let supported = false;
  switch (cfg.provider) {
    case "anthropic":
      supported = true;
      break;
    case "openai-compatible":
      supported = cfg.supports_tools !== false;
      break;
    case "ollama": {
      const show = await ollamaShow(cfg);
      if (show?.capabilities?.includes("tools")) {
        supported = true;
      } else if (show == null) {
        // Probe failed — fall back to the manual override (default false).
        supported = cfg.supports_tools === true;
      } else {
        supported = false;
      }
      break;
    }
  }

  toolSupportCache.set(key, supported);
  if (!supported) throw makeNoToolError(cfg);
}

function makeNoToolError(cfg: LlmBlock): BotholomewLlmError {
  return new BotholomewLlmError(
    "no_tool_support",
    `Model "${cfg.model}" (${cfg.provider}) does not support tool/function calling, which Botholomew requires.\n\n${TOOL_CAPABLE_HINT}`,
  );
}

/**
 * Resolve max input tokens for the given model. Lookup order:
 *   1. `cfg.max_input_tokens` override
 *   2. Ollama `/api/show` `model_info.<arch>.context_length`
 *   3. Hardcoded KNOWN_CONTEXT_WINDOWS table
 *   4. Provider-level fallback
 */
export async function getMaxInputTokens(cfg: LlmBlock): Promise<number> {
  if (cfg.max_input_tokens && cfg.max_input_tokens > 0) {
    return cfg.max_input_tokens;
  }
  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);
  if (cached !== undefined) return cached;

  let resolved: number | null = null;

  // For Ollama, skip /api/show — it reports the model's *maximum* (often
  // 128K+), but Ollama allocates KV cache for the full num_ctx up front.
  // Use the provider fallback so local Macs don't OOM. Users who want more
  // can set `llm.max_input_tokens` explicitly.
  if (cfg.provider !== "ollama") {
    const fromTable = KNOWN_CONTEXT_WINDOWS[cfg.model];
    if (fromTable && fromTable > 0) resolved = fromTable;
  }

  if (resolved == null) {
    resolved = FALLBACK_BY_PROVIDER[cfg.provider];
    logger.debug(
      `Falling back to default context window (${resolved}) for ${cfg.provider}:${cfg.model}. Set \`llm.max_input_tokens\` to override.`,
    );
  }

  tokenCache.set(key, resolved);
  return resolved;
}
