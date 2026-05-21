import { APICallError } from "@ai-sdk/provider";
import type { LlmBlock } from "../config/schemas.ts";

/**
 * Turn an unknown error from the AI SDK / fetch / provider into a short,
 * user-friendly string. Used by every LLM call site (chat, worker, title
 * generator, schedule evaluator, capability summarizer) so the TUI / logs
 * never have to render the AI SDK's raw `APICallError` (which dumps the
 * full request body, headers, and tool schemas on toString).
 */
export function formatLlmError(err: unknown, cfg?: LlmBlock): string {
  if (APICallError.isInstance(err)) {
    return formatApiCallError(err, cfg);
  }
  if (err instanceof Error) {
    const msg = err.message ?? String(err);
    if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|fetch failed/i.test(msg)) {
      if (cfg?.provider === "ollama") {
        const url = cfg.base_url || "http://localhost:11434";
        return `Can't reach Ollama at ${url}. Is the server running?`;
      }
      return `Network error: ${msg}`;
    }
    return msg;
  }
  return String(err);
}

function formatApiCallError(err: APICallError, cfg?: LlmBlock): string {
  const status = err.statusCode;
  const provider = cfg?.provider;

  if (status === 401 || status === 403) {
    if (provider === "anthropic") {
      return "Unauthorized — check `llm.api_key` (or `ANTHROPIC_API_KEY` env var).";
    }
    if (provider === "ollama") {
      const where = cfg?.base_url ?? "";
      if (where.includes("ollama.com")) {
        return "Unauthorized — Ollama Cloud requires a bearer token. Get one from https://ollama.com (account → API keys) and put it in `llm.api_key`.";
      }
      return "Unauthorized — your Ollama endpoint rejected the request.";
    }
    if (provider === "openai-compatible") {
      return "Unauthorized — check `llm.api_key` for your OpenAI-compatible endpoint.";
    }
    return "Unauthorized — check your API credentials.";
  }

  if (status === 404) {
    if (cfg) {
      return `Model not found: \`${cfg.model}\` on ${cfg.provider}. Check the model id (and \`base_url\` if remote).`;
    }
    return "Model not found. Check the model id and base_url.";
  }

  if (status === 429) {
    return "Rate limited by the provider. Wait and retry.";
  }

  if (status && status >= 500) {
    return `Provider error (${status}). Try again in a moment.`;
  }

  // Generic fallback — keep it short. Do NOT include `err.requestBodyValues`
  // (it contains the full prompt + tool schemas) or `err.responseHeaders`.
  return err.message || `Provider call failed${status ? ` (${status})` : ""}.`;
}

/**
 * Drain promises returned by `streamText` that we don't await on the error
 * path. The AI SDK exposes `usage`, `providerMetadata`, `text`, etc. as
 * eagerly-created promises tied to the underlying request; when the stream
 * errors out, these reject too. If we throw out of the for-await loop
 * before awaiting them, Node logs them as unhandled rejections — which is
 * what produced the giant request-body dump in the TUI.
 */
export function drainStreamPromises(result: {
  usage?: PromiseLike<unknown>;
  providerMetadata?: PromiseLike<unknown>;
}): void {
  const swallow = () => {};
  if (
    result.usage &&
    typeof (result.usage as Promise<unknown>).catch === "function"
  ) {
    void (result.usage as Promise<unknown>).catch(swallow);
  }
  if (
    result.providerMetadata &&
    typeof (result.providerMetadata as Promise<unknown>).catch === "function"
  ) {
    void (result.providerMetadata as Promise<unknown>).catch(swallow);
  }
}
