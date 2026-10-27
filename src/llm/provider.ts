import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { LlmBlock } from "../config/schemas.ts";
import { createFakeLanguageModel } from "./fake.ts";
import { BotholomewLlmError } from "./types.ts";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Return an AI SDK `LanguageModel` for the given config block. When
 * `BOTHOLOMEW_FAKE_LLM=1` is set, always returns a `MockLanguageModelV3`
 * regardless of provider — the fixture path is read inside the fake.
 */
export function getLanguageModel(cfg: LlmBlock): LanguageModel {
  if (process.env.BOTHOLOMEW_FAKE_LLM === "1") {
    return createFakeLanguageModel();
  }
  switch (cfg.provider) {
    case "anthropic": {
      if (!cfg.api_key) {
        throw new BotholomewLlmError(
          "no_credentials",
          "Anthropic provider requires an `api_key` on the model's entry in `models` (or the ANTHROPIC_API_KEY env var).",
        );
      }
      const anthropic = createAnthropic({ apiKey: cfg.api_key });
      return anthropic(cfg.model);
    }
    case "ollama": {
      const baseURL = `${(cfg.base_url || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "")}/api`;
      // When `api_key` is set, send it as a bearer token. Local Ollama
      // ignores auth headers; Ollama Cloud (https://ollama.com) requires
      // them. Same code path covers both.
      const headers = cfg.api_key
        ? { Authorization: `Bearer ${cfg.api_key}` }
        : undefined;
      const ollama = createOllama({ baseURL, headers });
      return ollama(cfg.model);
    }
    case "openai-compatible": {
      if (!cfg.base_url) {
        throw new BotholomewLlmError(
          "no_credentials",
          "OpenAI-compatible provider requires a `base_url` on the model's entry in `models`.",
        );
      }
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: cfg.base_url.replace(/\/+$/, ""),
        apiKey: cfg.api_key || undefined,
      });
      return provider(cfg.model);
    }
    default: {
      const exhaustive: never = cfg.provider;
      throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
    }
  }
}

export function describeModel(cfg: LlmBlock): string {
  return `${cfg.provider}:${cfg.model}`;
}
