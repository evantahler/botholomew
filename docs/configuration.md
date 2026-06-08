# Configuration

Botholomew reads its settings from `config/config.json` inside the
project directory. The full schema lives in `src/config/schemas.ts`.

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "api_key": ""
  },
  "chunker_llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "api_key": ""
  },
  "embedding_model": "Xenova/bge-small-en-v1.5",
  "embedding_dimension": 384,
  "tick_interval_seconds": 300,
  "max_tick_duration_seconds": 120,
  "system_prompt_override": "",
  "max_turns": 0,
  "worker_heartbeat_interval_seconds": 15,
  "worker_dead_after_seconds": 60,
  "worker_reap_interval_seconds": 30,
  "worker_stopped_retention_seconds": 3600,
  "schedule_min_interval_seconds": 60,
  "schedule_claim_stale_seconds": 300,
  "tui_idle_timeout_seconds": 180,
  "dream_lookback_hours": 24,
  "log_level": "",
  "membot_scope": "global",
  "mcpx_scope": "global"
}
```

---

## LLM providers

Botholomew talks to language models through the
[Vercel AI SDK](https://github.com/vercel/ai). Three providers ship today:
**Anthropic** (Claude), **Ollama** (local), and **OpenAI-compatible** (LM
Studio, llama.cpp's HTTP server, OpenRouter, vLLM, Groq, Together, etc.).

Whatever provider you pick, the model **must** support tool/function
calling — the agent's entire surface depends on structured tool calls.
Botholomew probes for tool support at startup and refuses to run with a
non-tool-capable model.

### `llm` (main agent) and `chunker_llm` (auxiliary)

Both blocks have the same shape:

| Field              | Default                          | Purpose                                                                  |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------ |
| `provider`         | `"anthropic"`                    | One of `anthropic`, `ollama`, `openai-compatible`.                       |
| `model`            | `claude-opus-4-6` / `…-haiku-…`  | Model id. Provider-specific.                                             |
| `base_url`         | `""`                             | Required for `openai-compatible`; optional for `ollama` (default `http://localhost:11434`); ignored for `anthropic`. |
| `api_key`          | `""`                             | Required for `anthropic`. Optional for `openai-compatible` and `ollama`. |
| `max_input_tokens` | `0`                              | Override the context window. `0` falls back to a lookup table and provider defaults. |
| `supports_tools`   | `true`                           | Override the tool-capability probe (only relevant for `openai-compatible`). |

`llm` governs chat and worker turns. `chunker_llm` governs auxiliary calls
(schedule evaluation, thread titles, capability summarization) and can point
at a smaller/cheaper model.

### Anthropic example

```jsonc
{
  "llm": { "provider": "anthropic", "model": "claude-opus-4-6", "api_key": "sk-ant-..." },
  "chunker_llm": { "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "api_key": "sk-ant-..." }
}
```

### Ollama (local) example

Run `ollama serve` and `ollama pull llama3.1:8b` first.

```jsonc
{
  "llm": { "provider": "ollama", "model": "llama3.1:8b" },
  "chunker_llm": { "provider": "ollama", "model": "qwen2.5:3b" }
}
```

Known-good tool-capable Ollama models: `llama3.1:8b`, `llama3.1:70b`,
`qwen2.5:7b`, `mistral-nemo`, `command-r`. Smaller models without the
`tools` capability (e.g. `gemma:2b`) will be refused at startup.

### OpenAI-compatible example

```jsonc
{
  "llm": {
    "provider": "openai-compatible",
    "model": "gpt-4o",
    "base_url": "https://openrouter.ai/api/v1",
    "api_key": "sk-or-..."
  }
}
```

Any OpenAI-compatible chat-completions endpoint that supports tool calling
works. Set `supports_tools: false` to opt out of the probe assumption.

---

## Keys

| Key | Default | Purpose |
|---|---|---|
| `llm` | see above | Provider + model for the main agent loop (workers + chat). See "LLM providers". |
| `chunker_llm` | see above | Provider + model for auxiliary calls (schedule eval, thread titles, capability summarization). |
| `embedding_model` | `Xenova/bge-small-en-v1.5` | A local [`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) feature-extraction model. Weights are downloaded on first use and cached under the project's `models/` directory. Any feature-extraction model in the Xenova/* namespace works — e.g. `Xenova/multilingual-e5-small` (also 384-dim) for non-English content. |
| `embedding_dimension` | `384` | Vector dimension. Must match the model. Changing model + dimension requires running `botholomew membot reembed` to recompute every stored vector — old and new vectors aren't comparable. |
| `tick_interval_seconds` | `300` | Seconds a `--persist` worker sleeps between ticks **when there's no work**. It ticks back-to-back while a backlog exists. |
| `max_tick_duration_seconds` | `120` | Soft cap per tick. Stale-task reset fires at `3×` this value. |
| `system_prompt_override` | `""` | Appended to the built-in system prompt. Use this for project-specific instructions that should be always-loaded without editing the files under `prompts/`. |
| `max_turns` | `0` | Maximum tool-use turns per agent loop (0 = unlimited). Safety net against runaway loops. |
| `worker_heartbeat_interval_seconds` | `15` | How often a running worker writes to `workers.last_heartbeat_at`. Runs on its own `setInterval`, independent of the tick loop, so long LLM calls don't starve the heartbeat. |
| `worker_dead_after_seconds` | `60` | A worker whose heartbeat is older than this is considered dead. The reaper flips its status to `dead` and releases every task/schedule claim it held. |
| `worker_reap_interval_seconds` | `30` | How often a `--persist` worker scans for dead peers to reap and prunes old cleanly-stopped workers. One-shot workers don't run the reaper. |
| `worker_stopped_retention_seconds` | `3600` | Cleanly-stopped workers older than this are deleted from the `workers` table. Dead workers are kept as forensic evidence and not auto-pruned. |
| `schedule_min_interval_seconds` | `60` | Minimum gap between successive evaluations of the same schedule. A schedule that ran less than this many seconds ago is skipped. |
| `schedule_claim_stale_seconds` | `300` | If a worker claimed a schedule but never released it (crash), another worker may steal the claim after this many seconds. |
| `tui_idle_timeout_seconds` | `180` | Seconds of inactivity (no keystrokes, no streamed agent tokens, no tool events) before the chat TUI freezes its visible animations and pauses the status-bar count refresh. Animations resume on the next activity. Set to `0` to disable (always animate — useful for demo recordings). |
| `dream_lookback_hours` | `24` | Default recall window for `botholomew dream` / `/dream` when no `--since` is given — the agent reviews threads from the last this-many hours. See [reflection.md](reflection.md). |
| `log_level` | `""` | Verbosity for `botholomew` CLI logs. One of `silent`, `error`, `warn`, `info`, `debug`. Empty string falls back to the runtime default (`info` normally, `error` under `NODE_ENV=test`). `BOTHOLOMEW_LOG_LEVEL` env var overrides this. |
| `membot_scope` | `"global"` | Where this project's knowledge store lives. `"global"` → `~/.membot/index.duckdb` (shared across every Botholomew project on the machine). `"project"` → `<projectDir>/index.duckdb` (isolated). Affects both the agent and the `botholomew membot …` CLI passthrough. |
| `mcpx_scope` | `"global"` | Where this project's MCP server config lives. `"global"` → `~/.mcpx/` (shared). `"project"` → `<projectDir>/mcpx/` (isolated). Affects both the agent and the `botholomew mcpx …` CLI passthrough. |

---

## Environment variables

| Var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Fills in `llm.api_key` / `chunker_llm.api_key` when the provider is `anthropic`. Always wins. |
| `OPENAI_API_KEY` | Fills in `api_key` when the provider is `openai-compatible` and the field is empty. |
| `OLLAMA_HOST` | Fills in `base_url` when the provider is `ollama` and the field is empty. |
| `BOTHOLOMEW_LOG_LEVEL` | Overrides `log_level` in config. One of `silent`, `error`, `warn`, `info`, `debug`. |
| `BOTHOLOMEW_NO_UPDATE_CHECK` | Disable the background "new version available" check. |

---

## Tuning guidance

**For personal/low-volume use:** defaults are fine. One tick every five
minutes is plenty when tasks are mostly "every morning, summarize my
email".

**For bursty workloads:** lower `tick_interval_seconds` to 30–60. A
persist worker only sleeps when the queue is empty, so this is safe — it
just reduces latency between the last item landing and the next tick
firing. Alternatively, spawn more one-shot workers (via cron or chat)
and leave the interval alone.

**For multi-worker setups:** if you routinely run more than a handful of
workers, consider lowering `worker_reap_interval_seconds` (so dead ones
are cleaned quickly) and raising `worker_dead_after_seconds` (so a
temporary DB-lock hiccup doesn't flip a live worker to dead). The
defaults (30s reap, 60s threshold) are conservative.

**For model-cost sensitivity:**

- Switch `llm.model` to `claude-sonnet-4-*` or `claude-haiku-*`. Opus is the
  default because quality on complex knowledge work matters more than
  per-token cost for most users, but Sonnet handles the majority of tasks
  well.
- The default `chunker_llm` already targets Haiku — leave it there.
- Lower `max_turns` (e.g., 15) to hard-cap tool-use budgets.
- For zero-API-cost runs, switch both blocks to a tool-capable Ollama model.
  Note: cache-token reporting is Anthropic-only, so the TUI will show all
  input tokens as fresh on local providers.

**For prompt-sensitive workflows:** use `system_prompt_override` to add
instructions without touching `prompts/goals.md`. This keeps the default
personality intact while layering on project-specific rules ("always
respond in British English", "never call mcp_exec on the slack server
without confirmation", …).

---

## Per-project vs. global

`config.json` itself is always per-project — different projects have
different goals, beliefs, and tuning. But the two data stores it points
at (`membot` for knowledge, `mcpx` for MCP servers) default to **shared
global** locations, because reusing a personal knowledge base and a set
of authenticated MCP servers across every project is almost always what
you want.

Defaults for new projects:

| Concern | Default scope | Resolves to |
|---|---|---|
| `membot_scope` | `"global"` | `~/.membot/` |
| `mcpx_scope` | `"global"` | `~/.mcpx/` |

To opt one (or both) into per-project isolation, set the key to
`"project"` in `config/config.json`, or pass `--membot-scope=project` /
`--mcpx-scope=project` to `botholomew init`. The agent loop, chat
session, TUI, and CLI passthroughs (`botholomew membot …`, `botholomew
mcpx …`) all honour the scope on every invocation.

Migrating between scopes:

- **Global → project**: `botholomew membot import-global` (copies
  `~/.membot/` into the project) or `botholomew mcpx import-global`
  (copies `~/.mcpx/`), then flip the scope key to `"project"`.
- **Project → global**: copy `<projectDir>/index.duckdb` to
  `~/.membot/index.duckdb` (or `<projectDir>/mcpx/*.json` to `~/.mcpx/`),
  then flip the scope key to `"global"`.

Projects initialized before the scope settings existed have no
`membot_scope` / `mcpx_scope` keys; both default to `"global"`, so the
agent reads the shared store. Any pre-existing project-local
`index.duckdb` or `mcpx/servers.json` is left in place but unused until
you flip the scope back.
