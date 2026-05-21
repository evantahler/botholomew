import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { LlmBlock } from "../config/schemas.ts";

type ProviderOptions = SharedV3ProviderOptions;

/**
 * Build the `providerOptions` payload passed to `streamText` / `generateText`
 * / `generateObject` for the current provider.
 *
 * For Ollama, this is critical: without `num_ctx` set per-request the server
 * defaults to whatever the model's Modelfile says (usually 4096), and any
 * prompt larger than that silently gets truncated — which mangles the
 * system prompt and tool schemas.
 *
 * Returns `undefined` for providers that don't need per-call options.
 */
export function buildProviderOptions(
  cfg: LlmBlock,
  numCtx: number,
): ProviderOptions | undefined {
  if (cfg.provider === "ollama") {
    return {
      ollama: {
        options: { num_ctx: numCtx },
      },
    };
  }
  return undefined;
}
