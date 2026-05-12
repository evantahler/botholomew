# Milestone 13: Replace the In-Tree Context System with `membot`

## Context

`src/context/`, `src/db/`, and the `context_*` / `search` agent-tool surface
duplicate functionality that now lives in the standalone
[`membot`](https://github.com/evantahler/membot) package. Membot was extracted
from this codebase and has since grown past its origin: ingestion, deterministic
chunking, local WASM embeddings, hybrid search, URL fetching, format conversion
(PDF/DOCX/XLSX/HTML/vision), refresh scheduling, append-only versioning, and
both an MCP server and a typed SDK are all first-class there. Keeping a parallel
in-tree implementation is pure cost — every bug fix and feature lands twice,
the Bun-specific `@huggingface/transformers` patch has to stay in sync across
both packages, and the agent has to learn two near-identical APIs (ours and
membot's via mcpx).

This milestone deletes Botholomew's in-tree context system and consumes membot
as a normal SDK dependency. The branch is `evantahler/kyoto-v1`, so we treat
this as a v1 rewrite: no migration code, no compatibility shims, no on-disk
`context/` directory carried forward.

## Goal

- Delete `src/context/` and `src/db/` (except `uuid.ts`, which moves to
  `src/utils/`).
- Replace the `context_*` and `search` tool surfaces with `membot_*` tools
  whose handlers call `MembotClient` SDK methods.
- Adopt membot's storage model: content lives in DuckDB, addressed by
  `logical_path`. No on-disk `context/` directory. Append-only versioning
  (new `version_id` per write, tombstones on delete).
- Delegate URL fetching and format conversion fully to membot. Drop our
  fetcher, markdown-converter, vision pipeline.
- Keep `botholomew context *` as a thin passthrough to the `membot` CLI,
  matching the pattern we already use for `mcpx` commands.
- Leave tasks, schedules, threads, workers, prompts, skills, logs, and config
  untouched — they are filesystem-only stores and unrelated to the context
  system.

## What this unblocks

- A single source of truth for ingestion, embeddings, and search. Bug fixes and
  features land once, in membot.
- Append-only history for everything the agent writes: `membot_versions` /
  `membot_diff` for free, with no extra work in Botholomew.
- URL ingest covering Google Docs, GitHub, Linear, and arbitrary web pages
  (Playwright print-to-PDF fallback) without us maintaining the
  fetcher/converter matrix.
- One less DuckDB schema to evolve. Membot owns `index.duckdb` end to end.
- A smaller surface area for the `evantahler/kyoto-v1` rewrite: one fewer
  subsystem to harden before cutting v1.

## Decisions

1. **All-in on membot's storage model.** Content lives in DuckDB blobs, keyed
   by `logical_path`. No `context/` directory on disk. Users access content via
   `membot_*` agent tools or the `botholomew context …` CLI passthrough.
2. **Per-project membot store.** Each project gets its own
   `<projectDir>/index.duckdb`. We pass `<projectDir>` as `home` to
   `buildContext` / `new MembotClient({ home })`. Matches today's per-project
   model. No shared global store.
3. **Direct SDK calls.** Botholomew imports `MembotClient` from `membot` and
   defines its own `ToolDefinition`s whose handlers call SDK methods. We do
   **not** consume membot's MCP server in-process; the perf cost of an MCP
   roundtrip per tool call is not worth the marginal code savings, and keeping
   our `ToolDefinition` pattern intact preserves the existing CLI exposure of
   each agent tool.
4. **Replace tool names with `membot_*`.** Agent learns membot's API. No
   `context_*` aliases.
5. **Append-only versioning is adopted as-is.** Every `membot_write` /
   `membot_edit` creates a new `version_id`. `membot_rm` is a tombstone.
   `membot_versions` / `membot_diff` expose history.
6. **No migration code.** This is a v1 rewrite branch. Users on the previous
   format start over; `CHANGELOG` calls this out.
7. **Thin CLI passthrough.** `src/commands/context.ts` becomes a Commander
   group that spawns `membot <args…>` with `MEMBOT_HOME=<projectDir>` and
   forwards stdio. Same pattern as `src/commands/mcpx.ts`. No per-subcommand
   maintenance.
8. **Reuse our line-patch edit shape.** Membot's `write` is whole-file replace.
   `membot_edit` is a Botholomew-side wrapper that does `read` →
   `applyLinePatches` (from `src/fs/patches.ts`) → `write`, preserving the
   git-hunk patch UX used by `task_edit`, `schedule_edit`, `prompt_edit`,
   `skill_edit`.

## Orthogonal — explicitly unchanged

The following are **not** part of the context system and **not** in scope for
this milestone. Their DuckDB tables were dropped in migrations 19–20; they are
filesystem-only stores today:

- `tasks/<id>.md`, `src/tasks/store.ts`, `task_*` tools
- `schedules/<id>.md`, `src/schedules/store.ts`, `schedule_*` tools
- `threads/<YYYY-MM-DD>/<id>.csv`, `src/threads/store.ts`, `thread_*` tools
- `workers/<id>.json`, `src/workers/store.ts`, `worker_*` tools
- `prompts/*.md`, `src/worker/prompt.ts`, `prompt_*` tools (M12)
- `skills/*.md`, `src/skills/*`, skill loader
- `logs/`, `config/`

Shared infrastructure that survives because these stores still need it:
`src/fs/sandbox.ts` (`resolveInRoot`), `src/fs/atomic.ts` (`atomicWrite`),
`src/fs/compat.ts` (sync-overlay-FS detector), the `O_EXCL` lockfile reaper,
`src/utils/v7-date.ts`, and `uuid.ts` (moves into `src/utils/`).

Membot owns `index.duckdb`. Botholomew **must not** add tables to it. Any
future Botholomew DB needs would live in a separate sidecar.

---

## Implementation

### 1. Dependencies (`package.json`)

- Add `"membot": "^0.12.1"`.
- Remove `@duckdb/node-api`, `@huggingface/transformers`, `onnxruntime-web`.
  Membot brings these transitively. Bun's resolver will dedupe to membot's
  copy, and membot's `patches/` directory carries the Bun-specific WASM patch
  for `@huggingface/transformers`, so ours is no longer needed.
- Delete `patches/@huggingface%2Ftransformers@*.patch`.
- Delete the "coexists with DuckDB native module" regression test in
  `test/context/embedder.test.ts`; the same invariant is covered upstream.
- Bump `version` in `package.json` for the auto-release.

### 2. New client singleton (`src/mem/client.ts`)

```ts
import { MembotClient } from "membot";

export function openMembot(projectDir: string): MembotClient {
  return new MembotClient({ home: projectDir });
}
```

One client per Botholomew process. Worker, chat, TUI, and CLI handlers each
open one on startup and close on shutdown. Membot's connection is lazy and
releases between operations, so the existing single-writer-with-retry posture
is preserved without our `withDb` helper.

### 3. `ToolContext` swap (`src/tools/types.ts`)

- Drop fields: `conn: DbConnection`, `dbPath: string`.
- Add field: `mem: MembotClient`.

Every tool handler that used `ctx.conn` or `withDb(ctx.dbPath, …)` now uses
`ctx.mem` instead. Old call sites in non-context tools (e.g., capabilities
refresh) just drop the unused argument.

### 4. New agent tools (`src/tools/membot/`)

One file per operation, mirroring the existing `src/tools/file/` and
`src/tools/search/` layout. Descriptions use the
`[[ bash equivalent command: <cmd> ]]` convention.

| Tool | Backed by | Notes |
|---|---|---|
| `membot_add` | `client.add(...)` | Ingest files/URLs/inline content |
| `membot_read` | `client.read(...)` | Optional `version` arg |
| `membot_write` | `client.write(...)` | Whole-file replace; new version |
| `membot_edit` | `read` → `applyLinePatches` → `write` | Wrapper; reuses `LinePatchSchema` from `src/fs/patches.ts` |
| `membot_mv` | `client.mv(...)` | |
| `membot_rm` | `client.rm(...)` | Tombstone-delete |
| `membot_cp` | `read` → `write` | Wrapper; membot has no native `cp` |
| `membot_ls` | `client.ls(...)` | |
| `membot_tree` | `client.tree(...)` | |
| `membot_info` | `client.info(...)` | |
| `membot_exists` | `info` + catch `not-found` | Wrapper |
| `membot_count_lines` | `read` + count `\n` | Wrapper |
| `membot_search` | `client.search(...)` | Hybrid (default) / semantic / keyword |
| `membot_versions` | `client.versions(...)` | List version history |
| `membot_diff` | `client.diff(...)` | Compare two versions |
| `membot_refresh` | `client.refresh(...)` | Re-fetch a URL source |
| `membot_pipe` | run another tool, capture stdout, `client.add({ sources: ["inline:…"] })` | Replaces `pipe_to_context` |

All tools follow the existing `ToolDefinition` pattern: Zod input schema →
Anthropic tool spec + CLI exposure, single source of truth.

### 5. Tool registry (`src/tools/index.ts`)

- Remove all `context_*` and `search` registrations.
- Register the new `membot_*` tools.
- `capabilities_refresh` continues to scan the registry; it will pick up the
  new tools without changes.

### 6. CLI passthrough (`src/commands/context.ts`)

Rewrite the file. Body becomes a Commander group that captures all remaining
args and `Bun.spawn`s `membot <args…>` with the environment augmented to set
`MEMBOT_HOME=<projectDir>`, forwarding stdio and exit code. Mirrors
`src/commands/mcpx.ts`. The existing subcommands (`import`, `reindex`, `tree`,
`stats`) all dissolve into this passthrough — `botholomew context add ./x.md`,
`botholomew context search "…"`, etc., work without per-command code.

Drop `src/commands/db.ts` entirely (membot owns its DB; users who need its
doctor run `membot doctor` via passthrough or directly).

Update `src/cli.ts` to remove the `db` registration; `context` stays registered
but now points at the rewritten module.

### 7. Init refactor (`src/init/index.ts`)

- Stop creating `<projectDir>/context/`.
- Stop calling `getConnection()` / `migrate(conn)` / `rebuildSearchIndex(conn)`.
- Open the membot client once (`openMembot(projectDir)`) and close it, which
  triggers membot's own migration on a fresh DB.
- Still create `tasks/`, `schedules/`, `threads/`, `workers/`, `prompts/`,
  `skills/`, `logs/`, `config/`, and seed the three default prompts
  (`goals.md`, `beliefs.md`, `capabilities.md`).
- Keep the sync-overlay-FS check (`src/fs/compat.ts::isSyncOverlay`) — tasks
  and schedules still need `O_EXCL` + atomic rename, which iCloud / Dropbox /
  OneDrive / NFS break. Refuse to init on a sync overlay unless `--force`.

### 8. Capabilities scanner relocation

`src/context/capabilities.ts` is not really a context concern — it scans the
tool registry and rewrites `prompts/capabilities.md`. Move it to
`src/prompts/capabilities.ts` and update its single caller
(`src/commands/capabilities.ts`). The body needs no other changes once it
imports the new tool registry.

### 9. Worker, chat, TUI rewiring

- `src/worker/tick.ts`, `src/worker/loop.ts`, `src/chat/session.ts`, and the
  Ink hooks under `src/tui/` (`useAppState.ts` etc.) carry a long-lived
  `dbPath: string` today. Replace with a `mem: MembotClient`, opened at
  startup and closed at shutdown.
- `src/chat/agent.ts` system prompt: rewrite the "your world is `context/`"
  framing to "your knowledge store is membot; retrieve with `membot_search`,
  drill in with `membot_read`."
- `src/init/templates.ts` default `goals.md` / `beliefs.md` prose: replace any
  `context_*` mentions with their `membot_*` equivalents.
- `src/skills/*` templates: same sweep.

### 10. Deletions

After consumers compile against the new tools, delete:

- `src/context/` entirely (`store.ts`, `reindex.ts`, `chunker.ts`,
  `embedder.ts`, `embedder-impl.ts`, `fetcher.ts`, `fetcher-errors.ts`,
  `markdown-converter.ts`, `url-utils.ts`, `locks.ts`, `capabilities.ts` —
  the last is moved, not deleted).
- `src/db/connection.ts`, `embeddings.ts`, `schema.ts`, `doctor.ts`,
  `query.ts`, the whole `migrations/` SQL directory. Move `uuid.ts` to
  `src/utils/uuid.ts` and delete the empty `src/db/` directory.
- `src/tools/file/*.ts` and `src/tools/file.ts` registry.
- `src/tools/search/*.ts`.
- `src/tools/context/pipe.ts` (replaced by `membot_pipe`).
- `src/commands/db.ts`.
- `patches/@huggingface%2Ftransformers@*.patch`.

### 11. Tests

Delete:

- `test/context/**` (9 files).
- `test/db/**` (6 files).
- `test/tools/search*.test.ts`, `test/tools/file-sandbox.test.ts`.
- `test/helpers.ts::setupTestDb` / `setupTestDbFile` (replace with
  `setupTestMembot` returning a `MembotClient` pointed at a per-test temp dir).

Add:

- `test/mem/client.test.ts` — open/close, per-project home isolation, basic
  round-trip add/read/search.
- `test/tools/membot/*.test.ts` — at least `add`, `read`, `write`, `edit`
  (line-patch round trip), `search` (hybrid), `versions`, `refresh`.

Existing `test/tasks/**`, `test/schedules/**`, `test/threads/**`,
`test/workers/**`, `test/prompts/**`, `test/skills/**` keep passing unchanged.

### 12. Docs

- **Delete** `docs/context-and-search.md`. Replace with a short stub that
  points readers at the [membot docs](https://github.com/evantahler/membot)
  and explains that Botholomew delegates ingestion/embeddings/search to it.
- **Rewrite** `docs/files.md` around the new framing: the agent's world is a
  membot store keyed by `logical_path`; tools are `membot_*`; history is
  append-only and queryable via `membot_versions` / `membot_diff`. Drop all
  language about the on-disk `context/` directory, symlink semantics, and
  per-path locks (membot handles its own locking internally).
- **Update** `docs/architecture.md`: remove the "search-index sidecar"
  section; add a "Knowledge store" section that names membot as the
  dependency and links out.
- **Update** `docs/tools.md`: replace the `context_*` and `search` rows with
  the `membot_*` rows from the table in section 4 above.
- **Update** `docs/tasks-and-schedules.md`, `docs/captures.md`,
  `docs/getting-started.md`, `docs/configuration.md`, `README.md`: replace
  any `context_*` references with `membot_*`. Update the on-disk-layout
  diagrams to drop the `context/` directory and replace it with
  `index.duckdb (membot)`.
- **Update** `CLAUDE.md` (project): delete the "DuckDB patterns
  (search-index sidecar only)" section entirely. Delete the parts of "On-disk
  patterns" that describe `context/`, per-path context locks, and `O_EXCL`
  for reindex. Add a short "Knowledge store (membot)" section: per-project
  store at `<projectDir>/index.duckdb`, accessed via the `MembotClient`
  singleton on `ToolContext.mem`, no other process should write to it.
- **Update** the sidebar in `docs/.vitepress/config.ts` to remove the
  `context-and-search` entry.
- **Update** `docs/changelog.md` with a v1-rewrite note: no migration, fresh
  start, `context/` directory removed, see milestone 13.

### 13. Constants (`src/constants.ts`)

- Drop `getDbPath` (membot owns the path; we never name it ourselves).
- Update `PROTECTED_AREAS`: remove `context/`. Keep `tasks/`, `schedules/`,
  `threads/`, `workers/`, `prompts/`, `skills/`, `logs/`, `config/`.
- Rewrite the canonical on-disk-tree header comment to match the new layout.

---

## Verification

- `bun run lint` clean (tsc --noEmit + biome).
- `bun test` — full suite green; the new `test/mem/**` and
  `test/tools/membot/**` cover the integration; all unrelated stores
  (`tasks`/`schedules`/`threads`/`workers`/`prompts`/`skills`) keep passing
  unchanged.
- `grep -r '@duckdb/node-api' src/` returns nothing.
- `grep -r '@huggingface/transformers' src/` returns nothing.
- `grep -r 'from "../context' src/` and `grep -r 'from "./context' src/`
  return nothing.
- `bun run docs:build` succeeds with no broken internal links.
- Manual smoke test:
  1. `bun run dev init` in a fresh dir → no `context/` directory;
     `index.duckdb` is created; the three default prompts land in
     `prompts/`.
  2. `bun run dev context add ./README.md` → membot CLI passthrough
     succeeds; row appears in `bun run dev context ls`.
  3. `bun run dev context search "<phrase from README>"` → returns a hit.
  4. `bun run dev chat` → ask the agent to add a URL and then search for it;
     confirm it calls `membot_add` then `membot_search` (visible in the
     thread CSV).
  5. `bun run dev worker start` → worker boots, ticks, can call `membot_*`
     tools without crashing; old tasks that referenced `context_*` are
     re-authored or fail loudly with a clear error.
  6. Write a file, then `membot_edit` it via a line patch — confirm a new
     `version_id` lands and `membot_versions` lists both.

---

## Out of scope

- TUI knowledge-base tab (membot's surface is exposed through the existing
  chat agent and CLI; a dedicated tab can come later).
- Auto-migrating users from the old `<projectDir>/context/` tree. This is the
  `evantahler/kyoto-v1` v1 rewrite — users start fresh.
- Sharing one membot store across multiple Botholomew projects (global home
  mode). The library supports it; Botholomew's surface stays per-project for
  now.
- Adding Botholomew-side tables to membot's `index.duckdb`. If we ever need
  our own DB, it goes in a separate sidecar.
- Exposing membot's MCP server out of the Botholomew binary. Power users who
  want it can run `membot serve` directly.
