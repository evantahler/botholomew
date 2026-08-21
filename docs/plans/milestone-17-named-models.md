# Milestone 17: Named Models

## Context

M14 made the provider pluggable but left model selection frozen in two fixed
config blocks:

- `llm` — chat and the worker agent loop
- `chunker_llm` — auxiliary calls (thread titles, capability summaries,
  schedule evaluation)

That milestone explicitly ruled out "a separate provider per call site"
([M14 out-of-scope](milestone-14-pluggable-llm-providers.md)), which was the
right call at the time — one active model per role kept the abstraction small
while the provider layer settled.

It became the limiting factor once people ran real workloads. There was no way
to keep several models configured side by side and pick one at launch: you
edited `config.json` to switch. In practice you want a cheap local model for
routine queue work, a frontier model for interactive chat, and the ability to
say "run *this* task on *that* model" without touching config.

**This milestone supersedes M14's one-model-per-role non-goal.**

## Goal

Turn models into a **named registry** with designated roles, and make the
choice selectable per run — for chat, for a whole worker, and for an
individual task or schedule.

Deliberately **not** in scope: any nested agent-spawn concept. Botholomew's
stance is DAGs of durable tasks, not fan-out subagents, so "run a worker on a
specific model" is the unit, not "spawn a subagent with a model".

## What shipped

- **Named registry.** `config.models` is a map of name → self-contained
  `LlmBlock`. `default_model` and `fast_model` point at two entries. Entries
  never inherit from each other, so an Ollama entry and an Anthropic entry sit
  side by side; keys omitted *within* an entry backfill from `DEFAULT_LLM`.

- **Ergonomic pointers.** Declare one model and it becomes both roles. Name an
  entry `default` / `fast` and the pointers find it. Omit `fast_model` with
  several models and it falls back to `default_model` — a fast model is an
  optimization, not a requirement. Declare several with no way to pick a
  default and loading fails rather than guessing.

- **`src/config/models.ts`** — the only reader of the registry:
  `resolveModel(config, name?)`, `resolveFastModel(config)`, and
  `resolveModelFor(config, {override, pinned})` for the precedence chain.
  Unknown names throw with every configured name listed, which is the recovery
  path for both humans and agents.

- **Per-run selection.** `--model <name>` on `chat`, `worker run`,
  `worker start`, and `dream`; `model:` frontmatter on tasks and schedules
  (with `--model` on `task add` / `task update` / `schedule add` and on the
  `create_task` / `update_task` / `create_schedule` / `spawn_worker` tools). A
  schedule's model is inherited by the tasks it spawns.

- **Precedence:** `--model` > task/schedule `model:` > `default_model`. The
  flag wins, per the usual CLI convention and because the inverse is a cost
  footgun: a `--model local` offline-debugging run shouldn't let tasks quietly
  escape to a paid model. When a flag displaces a pin, the worker logs it.

- **Resolution at boundaries.** `startChatSession`, `runDream`, and
  `runClaimedTask` resolve; `runChatTurn` and `runAgentLoop` take a resolved
  `llm: LlmBlock`. Worker resolution is **per task**, not per worker, because
  a `--persist` worker claims heterogeneous tasks. Neither agent loop reads
  config for its model any more, which also makes them testable with a
  synthetic block.

- **`assertToolCapable` actually runs.** It had zero call sites despite three
  docs claiming otherwise. User-selectable models is exactly what it's for, so
  it now runs at chat session start and per worker task — against the model
  actually selected, not the whole registry, so a broken entry you aren't
  using never blocks a run.

- **`requireProviderCreds` narrowed** from "validate `config.llm`" to
  "validate the block about to be used", for the same reason.

- **Status bar** shows the active model as `<name> · <provider>:<model>`. Once
  you can pick a model you need to see which one you got.

## Decisions

**Hard replace, no aliasing.** `llm` and `chunker_llm` are removed from the
schema. A config still containing either key **fails at load** with the new
shape printed inline. This is the same call M14 made when it dropped the flat
`model` / `chunker_model` / `anthropic_api_key` keys — Botholomew is pre-1.0
and the new shape is small enough to type by hand.

The loud failure matters more than it looks: without it, a stale config would
silently fall back to `DEFAULT_MODELS` and run Anthropic Opus, which reads as
"my old key was honored" while quietly billing differently. Detection plus a
hard error is not back-compat translation.

**Two flat pointers, not a nested `roles` block.** `BotholomewConfig` is
otherwise a flat scalar surface with exactly one nested object (`approvals`),
which needs bespoke deep-merge handling in `loadConfig` *because* it's nested.
Two strings don't earn a second such special case, and a future third role is
one more flat key rather than a schema change.

**Self-contained entries.** No shared base block, no cross-entry inheritance.
The alternative saves repeating an API key and costs a merge-order rule to
reason about at every call site. Env overrides already solve the repetition:
one `ANTHROPIC_API_KEY` fills every Anthropic entry at once.

**`fast_model` is not per-run selectable.** Titles, capability summaries, and
schedule evaluation are bookkeeping, not the work the user asked for. Making
them switchable would add surface area for no decision anyone wants to make.

**Fail-fast validation in `loadConfig`.** A dangling `default_model` /
`fast_model`, or an unresolvable set of models, throws at load. Config is
plain interfaces plus a shallow merge with no Zod, so this is the only guard
there is — and a typo there breaks every command.

**A typo'd `--model` is caught in the parent.** `spawnWorker` validates the
name before detaching, because a detached worker's errors go to its log file
and the flag would otherwise look like a silent no-op on the terminal.

## Out of scope

- Mid-session model switching (a `/model` slash command). Both loops resolve
  above their turn loop, so this needs re-resolution plumbing and a decision
  about the Anthropic prompt cache, which a model switch invalidates.
- Per-entry credential env vars. `ANTHROPIC_API_KEY` fills every Anthropic
  entry; distinct keys per entry must be set in the file.
- Cost/usage accounting per named model.
- Any nested agent-spawn concept (see Goal).
