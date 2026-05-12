# Context & search

Botholomew's knowledge store is the [`membot`](https://github.com/evantahler/membot) library.
Ingestion (PDF / DOCX / HTML / images → markdown), local WASM embeddings,
hybrid BM25 + semantic search, append-only versioning, and URL refresh all
live there. Every project gets its own `<projectDir>/index.duckdb` managed
by membot.

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

- **CLI**: `botholomew context <verb> …` is a thin passthrough that spawns
  `membot <verb> … --config <projectDir>`. Run `botholomew context --help` to
  see the full verb list. `botholomew context import-global` is the only
  Botholomew-specific subcommand — it copies `~/.membot` into the project.
- **Chat agent**: the agent calls `membot_add`, `membot_search`, `membot_read`,
  `membot_write`, `membot_edit`, `membot_move`, `membot_delete`,
  `membot_versions`, `membot_diff`, `membot_refresh`, etc. See
  [`docs/files.md`](./files.md) for the full tool surface and the
  Botholomew-side wrappers (`membot_edit`, `membot_copy`, `membot_exists`,
  `membot_count_lines`, `membot_pipe`).
- **In-process**: every Botholomew process opens one `MembotClient` via
  `src/mem/client.ts::openMembot(projectDir)`. Workers, the chat session, and
  the TUI Context panel all share that handle through `ToolContext.mem`.

## On-disk layout

```
<projectDir>/
  index.duckdb     ← membot's knowledge store
  config.json      ← membot config (separate from <projectDir>/config/config.json)
```

Everything else under `<projectDir>` — `tasks/`, `schedules/`, `threads/`,
`prompts/`, `skills/`, `workers/`, `logs/`, `mcpx/`, `config/` — is still
Botholomew-owned and lives as real files on disk.
