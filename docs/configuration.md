# Configuration

Botholomew reads its settings from `.botholomew/config.json`. The full
schema lives in `src/config/schemas.ts`.

```json
{
  "anthropic_api_key": "",
  "openai_api_key": "",
  "model": "claude-opus-4-20250514",
  "chunker_model": "claude-haiku-4-5-20251001",
  "embedding_model": "text-embedding-3-small",
  "embedding_dimension": 1536,
  "tick_interval_seconds": 300,
  "max_tick_duration_seconds": 120,
  "system_prompt_override": "",
  "max_turns": 0
}
```

---

## Keys

| Key | Default | Purpose |
|---|---|---|
| `anthropic_api_key` | `""` | Anthropic key. `ANTHROPIC_API_KEY` env var overrides. |
| `openai_api_key` | `""` | OpenAI key for embeddings. `OPENAI_API_KEY` env var overrides. |
| `model` | `claude-opus-4-20250514` | Claude model for the main agent loop (daemon + chat). |
| `chunker_model` | `claude-haiku-4-5-20251001` | Smaller/cheaper model used to propose chunk boundaries during ingestion. |
| `embedding_model` | `text-embedding-3-small` | OpenAI embedding model. |
| `embedding_dimension` | `1536` | Vector dimension. Must match the model; changes require re-indexing (migration 5 did this once for the switch from 384-dim local embeddings). |
| `tick_interval_seconds` | `300` | Seconds the daemon sleeps between ticks **when there's no work**. It ticks back-to-back while a backlog exists. |
| `max_tick_duration_seconds` | `120` | Soft cap per tick. Stale-task reset fires at `3×` this value. |
| `system_prompt_override` | `""` | Appended to the built-in system prompt. Use this for project-specific instructions that should be always-loaded without editing `soul.md`. |
| `max_turns` | `0` | Maximum tool-use turns per agent loop (0 = unlimited). Safety net against runaway loops. |

---

## Environment variables

| Var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Overrides `anthropic_api_key` in config. |
| `OPENAI_API_KEY` | Overrides `openai_api_key` in config. |
| `BOTHOLOMEW_NO_UPDATE_CHECK` | Disable the background "new version available" check. |

---

## Tuning guidance

**For personal/low-volume use:** defaults are fine. One tick every five
minutes is plenty when tasks are mostly "every morning, summarize my
email".

**For bursty workloads:** lower `tick_interval_seconds` to 30–60. The
daemon only sleeps when the queue is empty, so this is safe — it just
reduces latency between the last item landing and the next tick firing.

**For model-cost sensitivity:**

- Switch `model` to `claude-sonnet-4-*` or `claude-haiku-*`. Opus is the
  default because quality on complex knowledge work matters more than
  per-token cost for most users, but Sonnet handles the majority of
  tasks well.
- The `chunker_model` is already Haiku — leave it there.
- Lower `max_turns` (e.g., 15) to hard-cap tool-use budgets.

**For prompt-sensitive workflows:** use `system_prompt_override` to add
instructions without touching `soul.md`. This keeps the default
personality intact while layering on project-specific rules ("always
respond in British English", "never call mcp_exec on the slack server
without confirmation", …).

---

## Per-project vs. global

There is no global config — everything is per-project. This is
deliberate: different projects have different goals, different MCP
servers, different beliefs. One Botholomew project's config shouldn't
leak into another's.

`~/.botholomew/` (the home-dir sibling of the project dir) is used for
*registry* data — the list of projects with watchdogs installed — not
for configuration.
