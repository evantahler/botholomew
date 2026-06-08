# Context & search

Botholomew's knowledge store is the [`membot`](https://github.com/evantahler/membot) library.
Ingestion (PDF / DOCX / HTML / images → markdown), local WASM embeddings,
hybrid BM25 + semantic search, append-only versioning, and URL refresh all
live there. By default the store is **shared globally** at `~/.membot/index.duckdb`,
so every Botholomew project on the machine sees the same knowledge — switch
`membot_scope` to `"project"` in `config/config.json` to isolate a project at
`<projectDir>/index.duckdb`. See [Storage scope](#storage-scope) below.

This page is intentionally short — the canonical docs live with membot.

## What lives where

| Concern | Where |
|---|---|
| Ingestion (chunking, embedding, refresh) | [membot README](https://github.com/evantahler/membot#readme) |
| Search (semantic, BM25, hybrid RRF) | [`membot search` docs](https://github.com/evantahler/membot#operations) |
| Format converters (PDF/DOCX/HTML/image/LLM-fallback) | [membot README](https://github.com/evantahler/membot#converters) |
| URL fetchers (Google Docs, GitHub, Linear, generic) | [membot README](https://github.com/evantahler/membot#downloaders) |
| Versioning & history | [`membot versions` / `membot diff`](https://github.com/evantahler/membot#operations) |
| Agent tool wrappers that surface the above | [`docs/files.md`](./files.md) |

## Calling membot from Botholomew

- **CLI**: `botholomew membot <verb> …` is a thin passthrough that spawns
  `membot <verb> … --config <resolvedDir>`, where `<resolvedDir>` follows the
  `membot_scope` setting (see below). Run `botholomew membot --help` for the
  verb list. `botholomew membot import-global` is the only Botholomew-specific
  subcommand — it copies `~/.membot` into `<projectDir>` (useful when migrating
  global → project).
- **Chat agent**: the agent calls `membot_add`, `membot_search`, `membot_read`,
  `membot_write`, `membot_edit`, `membot_move`, `membot_remove`,
  `membot_versions`, `membot_diff`, `membot_refresh`, etc. See
  [`docs/files.md`](./files.md) for the full tool surface and the
  Botholomew-side wrappers (`membot_edit`, `membot_copy`, `membot_exists`,
  `membot_count_lines`, `membot_pipe`).
- **In-process**: every Botholomew process opens one `MembotClient` via
  `src/mem/client.ts::openMembot(resolveMembotDir(projectDir, config))`. Workers,
  the chat session, and the TUI Context panel all share that handle through
  `ToolContext.mem`.

## Search quality & reranking

membot 0.18.0 reworked the embedding and search pipeline. Two things are worth
knowing from Botholomew's side:

- **Optional cross-encoder reranker.** `membot_search` (and `botholomew membot
  search`) now accepts `rerank=true` to rescore the top hybrid candidates with a
  local cross-encoder (ms-marco-MiniLM by default) for higher precision at the
  cost of latency — the first reranked query downloads the model. Hits then carry
  a `rerank_score` and the result reports `reranked: true`. Leave it off for the
  fast hybrid path. The default is configurable in membot's own `config.json`
  (`search.rerank`, `search.rerank_model`), and `search.max_per_file` caps how
  many chunks a single `logical_path` contributes to a result set.
- **Heading-aware chunking** (`chunker.markdown_aware`, on by default) splits
  markdown at heading boundaries and embeds a breadcrumb per chunk, so snippets
  carry their section context.

### Re-embed after upgrading

The 0.18.0 embedding fixes (CLS pooling for BGE models, smaller chunks that fit
the 512-token window) change the embedding revision. **Existing stores built
under an older membot keep their old vectors and silently degrade semantic
search until they are re-embedded** — membot prints a stale-revision warning on
search when this is the case. Re-embed once per store with:

```sh
botholomew membot reindex --embeddings
```

(Run it for each scope you use — the global `~/.membot` store and any
`membot_scope: "project"` stores.) Fresh stores created on 0.18.0+ need no
action.

## Storage scope

`membot_scope` in `config/config.json` controls where the knowledge store
lives:

| Value | Resolves to | Use when |
|---|---|---|
| `"global"` (default) | `~/.membot/index.duckdb` | You want one personal knowledge base reused across every Botholomew project. |
| `"project"` | `<projectDir>/index.duckdb` | You want strict per-project isolation (e.g. client work that shouldn't mix with personal notes). |

Switch with one of:

- `botholomew init --membot-scope=project` (new project)
- Edit `config/config.json` and set `"membot_scope": "project"` (existing project)
- Run `botholomew membot import-global` to seed the project-local store from
  `~/.membot` before flipping the scope.

## On-disk layout

When `membot_scope` is `"global"` (the default):

```
~/.membot/
  index.duckdb     ← shared membot knowledge store
  config.json      ← membot's own config
```

When `membot_scope` is `"project"`:

```
<projectDir>/
  index.duckdb     ← project-local membot knowledge store
  config.json      ← membot config (separate from <projectDir>/config/config.json)
```

Everything else under `<projectDir>` — `tasks/`, `schedules/`, `threads/`,
`prompts/`, `skills/`, `workers/`, `logs/`, `mcpx/`, `config/` — is still
Botholomew-owned and always lives in the project regardless of scope.
