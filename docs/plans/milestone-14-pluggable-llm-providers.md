# Milestone 14: Pluggable LLM Providers (Local Execution Possible)

## Context

Botholomew is positioned as a **local** agent for knowledge work, but until
this milestone every LLM call was hard-wired to `@anthropic-ai/sdk`. Workers,
chat, the schedule evaluator, the title generator, and the capability
summarizer all instantiated an `Anthropic` client directly. Running Botholomew
required a Claude API key, full stop.

This milestone introduces an LLM provider abstraction so users can run
Botholomew against Anthropic (Claude), Ollama (local), or any
OpenAI-compatible endpoint (LM Studio, llama.cpp, OpenRouter, vLLM, Groq,
Together, etc.). Fully-local execution becomes a first-class supported path;
Claude remains the default.

The underlying primitive is the [Vercel AI SDK](https://github.com/vercel/ai)
(`ai` package), with per-provider plugins. Botholomew keeps its own turn loop
— max_turns, parallel tool execution, queued user injections, terminal worker
tools, per-turn system-prompt rebuild — and only delegates the model-call
boundary.

## Goal

- Remove `@anthropic-ai/sdk` as a direct dependency.
- Adopt the Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `ollama-ai-provider-v2`
  + `@ai-sdk/openai-compatible`).
- Ship three providers from day one: **Anthropic**, **Ollama**,
  **OpenAI-compatible**.
- Replace the flat `model` / `chunker_model` / `anthropic_api_key` config keys
  with nested `llm` / `chunker_llm` blocks.
- Make tool-calling support a hard runtime invariant: refuse to run with a
  non-tool-capable model and explain how to recover.
- Preserve Anthropic prompt caching where it applies; gracefully report zero
  cache tokens elsewhere.

## What this unblocks

- **Fully-local workflows.** `ollama serve` + a tool-capable model
  (`llama3.1:8b`, `qwen2.5:7b`, `mistral-nemo`, `command-r`) and Botholomew
  works with no outbound network calls.
- **Bring-your-own-vendor.** Any OpenAI-compatible endpoint plugs in via
  `provider: "openai-compatible"` + `base_url`.
- **Provider shopping** without code changes. Swap `llm.provider` and
  `llm.model` and restart.
- **Future providers** follow the same plugin pattern (Google, Mistral,
  whatever AI SDK gains next) without further refactoring.

## Decisions

1. **Vercel AI SDK as the abstraction layer.** Hand-rolled provider
   interfaces would duplicate work that the AI SDK already does well. We
   import `streamText`, `generateText`, and `generateObject`; everything else
   is provider-plugin glue.
2. **Three providers ship at once.** Anthropic + Ollama + OpenAI-compatible.
   The OpenAI-compatible plugin alone unlocks LM Studio, llama.cpp's HTTP
   server, OpenRouter, vLLM, Groq, Together, and friends.
3. **Tools are required.** If the configured model can't call tools, refuse
   to run with a clear, actionable error listing known-good models per
   provider. There is no ReAct-style text-protocol fallback — the agent's
   entire surface depends on structured tool calls, and emulating them in
   text is brittle and a lot of code for marginal gain.
4. **Clean break on config shape.** Nested `llm` / `chunker_llm` blocks. The
   legacy `model`, `chunker_model`, and `anthropic_api_key` keys are
   **removed**, not migrated. We treat this as a breaking change because
   Botholomew is pre-1.0 and the new shape is small enough to type by hand.

## Architecture

A new `src/llm/` module is the only place the AI SDK is allowed to be
imported. Every call site outside `src/llm/` goes through its exports.

```
src/llm/
  index.ts          // public re-exports
  types.ts          // LlmBlock, LlmProvider, CacheTokens, BotholomewLlmError
  provider.ts       // getLanguageModel(cfg) → LanguageModel; describeModel
  capabilities.ts   // assertToolCapable / getMaxInputTokens
  tools.ts          // toAiSdkTool / toAiSdkTools (Botholomew ToolDefinition → AI SDK Tool)
  usage.ts          // extractCacheTokens(usage, providerMetadata) → CacheTokens
  cache-control.ts  // withAnthropicCacheBreakpoints (no-op for non-Anthropic)
  abort.ts          // createAbortHandle wrapper for the chat Esc path
  fake.ts           // MockLanguageModelV3 backed by BOTHOLOMEW_FAKE_LLM[_FIXTURE]
```

**Convention** (codified in `CLAUDE.md`): never import `@ai-sdk/*` or any
provider plugin from outside `src/llm/`. The rest of the codebase only sees
the Botholomew types and the AI SDK's neutral `ModelMessage` / `ToolSet` /
`LanguageModelUsage` surface.

Botholomew's turn loop continues to drive the agent. `streamText` is used in
single-step mode (no `stopWhen`) because the loop also handles:

- Queued user injections between turns (chat steering).
- Terminal worker tools (`complete_task` / `fail_task` / `wait_task`).
- Per-turn system-prompt rebuild (contextual `prompts/` matching).
- `fitToContextWindow` between turns.
- Soft-error reporting via the `is_error` output convention.

Delegating multi-step execution to AI SDK's `stopWhen` would force us to
wrap with callbacks anyway and lose features. Net negative.

## Provider matrix

| Provider             | Tool support source         | Context window source                              | Cache tokens reported? | Required config                          |
| -------------------- | --------------------------- | -------------------------------------------------- | ---------------------- | ---------------------------------------- |
| `anthropic`          | Assumed true                | Hardcoded `KNOWN_CONTEXT_WINDOWS` table            | **Yes**                | `api_key` (or `ANTHROPIC_API_KEY`)       |
| `ollama`             | `GET /api/show` capabilities | `/api/show` `model_info.<arch>.context_length`     | No (zeros)             | none (default `http://localhost:11434`)  |
| `openai-compatible`  | Assumed true (override-able) | Hardcoded table → provider fallback                | No (zeros)             | `base_url` (+ optional `api_key`)        |

Manual overrides on `LlmBlock` for both `max_input_tokens` and
`supports_tools` cover the long tail.

## Config shape

```jsonc
{
  "llm": {
    "provider": "ollama",
    "model": "llama3.1:8b",
    "base_url": "http://localhost:11434"
  },
  "chunker_llm": {
    "provider": "ollama",
    "model": "qwen2.5:3b"
  }
}
```

Or with Anthropic (the default):

```jsonc
{
  "llm": { "provider": "anthropic", "model": "claude-opus-4-6", "api_key": "..." },
  "chunker_llm": { "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "api_key": "..." }
}
```

Or with an OpenAI-compatible endpoint:

```jsonc
{
  "llm": {
    "provider": "openai-compatible",
    "model": "gpt-4o",
    "base_url": "https://openrouter.ai/api/v1",
    "api_key": "..."
  }
}
```

Env-var precedence (applied after deep-merge):

| Env var             | Applied to                                                       |
| ------------------- | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | `llm.api_key` / `chunker_llm.api_key` (anthropic only; wins)     |
| `OPENAI_API_KEY`    | `*.api_key` (openai-compatible only, when unset)                 |
| `OLLAMA_HOST`       | `*.base_url` (ollama only, when unset)                           |

## Tool-support invariant

Tools are not optional. Botholomew's worker loop, schedule evaluator, and
capability summarizer all rely on the model producing structured tool calls.
`assertToolCapable(cfg)` runs at boundary entry (chat session start, worker
startup) and throws `BotholomewLlmError("no_tool_support", …)` with a
message that lists known-good models per provider and tells the user to set
`llm.supports_tools: true` to override.

Per provider:

- **Anthropic** — assumed `true`.
- **Ollama** — probed via `POST /api/show` against the configured `base_url`;
  the response's `capabilities` array must include `"tools"`.
- **OpenAI-compatible** — no portable probe exists; assumed `true` unless
  `supports_tools: false` is set.

The result is memoized per `provider:model:base_url` for process lifetime.

## What we keep, what we lose

**Keep:**

- The Botholomew turn loop and all of its features (max_turns, parallel tool
  execution, queued injections, terminal worker tools, per-turn system-prompt
  rebuild, `fitToContextWindow`).
- The soft-error `is_error` convention on tool output schemas.
- Anthropic prompt caching (system + last assistant message marked with
  `cacheControl: ephemeral` via `providerOptions.anthropic`).
- The `BOTHOLOMEW_FAKE_LLM` / `BOTHOLOMEW_FAKE_LLM_FIXTURE` test seam — the
  fixture file format is unchanged; only the internals were rewritten on top
  of AI SDK's `MockLanguageModelV3`.

**Lose:**

- Cache-token reporting on non-Anthropic providers (Ollama / OpenAI-compatible
  surface zeros; the TUI shows all input as fresh — fundamental, not worth
  papering over).
- `client.beta.models.retrieve` for context-window lookup; replaced by an
  in-tree `KNOWN_CONTEXT_WINDOWS` table + Ollama `/api/show` + provider-level
  fallback + `max_input_tokens` override.
- Anthropic-specific streaming behaviors (e.g. the `tool-input-start` → `tool-call`
  split) when the provider doesn't expose them. The UI spinner gracefully
  skips the "preparing → executing" transition on Ollama.

## Out of scope

- ReAct-style text tool-call emulation for non-tool models.
- Automatic migration of legacy config keys. Old configs fail validation
  with a pointer to `docs/configuration.md`.
- A provider-specific tool router (e.g. silently downgrade tool args for
  weaker models). If a model can call tools, it can call ours.
- A separate provider per call site. A single `llm` block governs chat,
  worker, and capabilities; `chunker_llm` governs auxiliary calls
  (schedules, title generation). No chat-vs-worker provider split today.

## Verification

End-to-end checks before merge:

1. **Anthropic (regression).** `ANTHROPIC_API_KEY=… bun run dev chat` in a
   test project. Streaming, tool calls, Esc abort, cache token reporting in
   the TUI status bar all work.
2. **Ollama (the headline).** `ollama serve` + `ollama pull llama3.1:8b`. Set
   `llm.provider = "ollama"`, `llm.model = "llama3.1:8b"`. `bun run dev chat`.
   A task that requires `membot_search` + `task_complete` executes; cache
   tokens are zero; no API key is set.
3. **Ollama tool-support refusal.** `ollama pull gemma:2b` (no tool support).
   `bun run dev chat` fails fast with the `no_tool_support` error and lists
   known-good models.
4. **OpenAI-compatible.** `llm.base_url` pointed at LM Studio or OpenRouter
   with a tool-capable model. Chat + worker both function.
5. **Worker path.** `bun run dev tasks add …`, start a worker, confirm it
   executes a task end-to-end on Ollama.
6. **Schedules.** Create a schedule with a natural-language `when:`, run a
   worker tick, confirm `generateObject` returns a valid evaluation under
   both Anthropic and Ollama.
7. `bun run lint` and `bun test` pass.
