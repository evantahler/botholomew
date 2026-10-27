# Milestone 16: Reflections (`dream`)

## Context

By M15 the agent had every primitive needed to learn from itself but nothing
that *used* them on purpose:

- Conversations pile up as thread CSVs under `threads/`. Episodic memory tools
  (`list_threads`, `search_threads`, `view_thread`) let the agent recall them,
  but nothing distilled them.
- Self-modification existed — `prompt_edit` can rewrite `goals.md` / `beliefs.md`
  (respecting `agent-modification`) — but the agent never proposed its own edits.
- The knowledge store (membot) could hold durable facts, but facts learned in
  conversation stayed buried in transcripts.

This milestone closes [#247](https://github.com/evantahler/botholomew/issues/247)
(reflection loop) and the user-facing half of
[#249](https://github.com/evantahler/botholomew/issues/249) (episodic memory).

## Goal

Give the agent a **reflection ("dream")** pass that reviews recent threads,
consolidates durable facts into the knowledge store, and applies justified
edits to its own prompts — exposed both as a built-in `/dream` chat command and
a `botholomew dream` CLI. Deliberately **no new machinery**: it composes the
existing thread/membot/prompt tools through the existing chat agent loop.

## What shipped

- **`/dream`** — a *built-in* slash command (like `/clear`), not a seeded
  user-editable skill, so reflection behaves consistently and `dream` is a
  reserved skill name. Queues the shared reflection prompt as a user message in
  chat (`src/skills/commands.ts`, prompt in `src/chat/dream-prompt.ts`).
- **`botholomew dream [--since <iso|24h|7d>] [--dry-run]`** — runs the same
  reflection non-interactively via `runChatTurn`, logged to a `Dream — <date>`
  thread for auditability (`src/commands/dream.ts`). `--dry-run` makes the agent
  propose edits without writing.
- **`botholomew thread search <query>`** — user-facing CLI over the existing
  scan, factored into a shared `searchThreads()` helper in
  `src/threads/store.ts` (the `search_threads` agent tool now delegates to it).
- **`dream_lookback_hours`** config knob (default `24`) — the default recall
  window when `--since` is omitted.

## What a dream does

1. Recall recent threads (scoped to the window) via the thread tools.
2. Distill durable facts into membot at `reflections/<UTC-date>.md` (namespaced
   so a shared global store doesn't blur projects) plus natural `logical_path`s.
3. Read and apply small, justified edits to `goals.md` / `beliefs.md` via
   `prompt_edit`.
4. Report an audit summary.

## Out of scope (deferred)

- A built-in scheduler / init-seeded reflection schedule. Run `botholomew dream`
  from cron instead (documented in `docs/automation.md`).
- Option 1 of #249 (ingesting full thread transcripts into membot for
  semantic search). The dream loop writes *distilled* reflections to membot;
  raw-transcript ingestion remains a possible future enhancement.

## Docs

`docs/reflection.md` (new, in the sidebar), plus updates to
`docs/automation.md`, `docs/configuration.md`, `docs/tui.md`, and the README.
