# Botholomew

An AI agent for knowledge work. See `docs/plans/README.md` for the milestone roadmap.

## Project Structure

- `src/` — TypeScript source code
  - `cli.ts` — CLI entrypoint (Commander.js)
  - `commands/` — CLI subcommand handlers
  - `config/` — Configuration loading/schemas
  - `fs/` — Path sandbox (`resolveInRoot`), atomic-write/lockfile helpers, sync-overlay-FS detector
  - `context/` — Disk-backed context store, ingest pipeline, chunker, embedder, reindex
  - `tasks/` — Task frontmatter schema, file CRUD, lockfile-based claim
  - `schedules/` — Same shape as tasks, on `schedules/<id>.md`
  - `threads/` — CSV-backed conversation log (`threads/<YYYY-MM-DD>/<id>.csv`)
  - `workers/` — Pidfile + heartbeat store under `workers/<id>.json`
  - `worker/` — Worker tick loop, LLM integration, prompt building, heartbeat
  - `db/` — DuckDB connection for the search-index sidecar (`@duckdb/node-api`), schema migrations
  - `init/` — Project initialization
  - `tui/` — Ink (React) TUI components
  - `utils/` — Logger, frontmatter, v7-date helpers
- `test/` — Tests (mirrors src/ structure)
- `docs/` — User-facing markdown docs (also published at [www.botholomew.com](https://www.botholomew.com))
  - `docs/.vitepress/` — VitePress config + theme overrides for the published site
  - `docs/public/` — Static assets served at site root (CNAME, favicon, hero GIF)
- `docs/plans/` — Milestone plans and roadmap (excluded from the published site)

## Commands

- `bun test` — Run all tests
- `bun run dev` — Run the CLI in development
- `bun run build` — Compile to standalone binary

## Tech Stack

- **Runtime**: Bun + TypeScript
- **Storage**: Real files on disk (markdown w/ frontmatter for tasks/schedules/prompts; CSV for threads; plain files for `context/`); DuckDB (`@duckdb/node-api`) for the search-index sidecar (`index.duckdb`) only — fully derivable from disk
- **LLM**: Anthropic SDK (`@anthropic-ai/sdk`)
- **CLI**: Commander.js
- **TUI**: Ink 6 + React 19
- **Tools**: MCPX

## Conventions

- **Always use `bun`** — never use `npm`, `npx`, `yarn`, or `node`. This is a Bun project: `bun install`, `bun test`, `bun run <script>`, `bunx` for one-off binaries.
- Bump `version` in `package.json` for every change merged to `main` — the auto-release workflow uses this to determine when to publish. **Exception**: docs-only changes (anything under `docs/`, plus `README.md`) do not need a version bump, since they don't affect the published binary.
- Run `bun run lint` and `bun test` before committing
- `bun run lint` runs both `tsc --noEmit` and `biome check`
- Each on-disk area has its own store module: `src/context/store.ts`, `src/tasks/store.ts`, `src/schedules/store.ts`, `src/threads/store.ts`, `src/workers/store.ts`. The `src/db/` layer is now just the search-index sidecar.
- All path-taking tools route through `src/fs/sandbox.ts::resolveInRoot` — no exceptions
- All agent interactions are logged to the thread CSV at `threads/<YYYY-MM-DD>/<id>.csv`
- **List operations always support `-l, --limit <n>` and `-o, --offset <n>`** — applies to every CLI `list` subcommand and every list function in `src/{tasks,schedules,threads,workers}/store.ts`. Pick a stable sort (typically newest-first by `id`, since uuidv7 is time-ordered) so pagination is deterministic.
- The agent has no shell. File access is exposed through `context_*` tools that pin to `<root>/context/`; tasks, schedules, and threads have their own typed tools
- When designing or modifying agent tools, follow PATs (Patterns for Agentic Tools): https://arcade.dev/patterns/llm.txt — key principles: error-guided recovery, next-action hints, token-efficient outputs, error classification
- **Tool descriptions mirror bash when applicable** — if an LLM tool behaves like a familiar CLI command (e.g., `cat`, `ls`, `mv`, `grep`), prefix its `description` with `[[ bash equivalent command: <cmd> ]] ` followed by the short description. This anchors the tool for the model and keeps the tag machine-parseable. Omit the tag for tools with no natural bash analog (e.g., `update_beliefs`, `read_large_result`).

## On-disk patterns

- **Project root is the cwd.** `bothy init` writes its tree at `<cwd>/{config,prompts,context,tasks,schedules,threads,workers,logs,…}` — there is no `.botholomew/` wrapper.
- **Path sandbox is non-negotiable.** Every tool that takes a `path` arg routes through `src/fs/sandbox.ts::resolveInRoot(root, userPath, opts)`. NFC-normalize, reject NUL/`..`/absolute, lstat-walk every component. By default symlink components are rejected; read-side ops on `context/` (read, list, tree, info, search, reindex, delete) opt in via `allowSymlinks: true` so users can drop symlinks into the agent's tree, but mutating ops never set the flag — the agent cannot write/edit/move/copy/mkdir through a user-placed symlink. `deleteContextPath` is the one exception that allows symlinks: it `lstat`s the leaf and `unlink`s the link without touching its target. Walks (`walk`, `collectFiles`, `treeRecurse`) follow symlinks with `dev:ino` cycle detection capped at 32 levels. New tools that touch paths MUST use this helper.
- **Atomic-write-via-rename for status mutations.** `src/fs/atomic.ts::atomicWrite` writes a `*.tmp.<wid>` then `fs.rename`s. Reads-before-writes (tasks/schedules/prompts) compare the file's `mtime` between read and write — abort and retry if it changed.
- **`O_EXCL` lockfiles** for tasks, schedules, and reindex. Body holds the worker id and `claimed_at`. Release = `unlink`. Reaper walks the lock dirs and unlinks orphans whose owner is dead in `workers/`.
- **Filesystem compatibility**: `init` and worker startup detect iCloud / Dropbox / OneDrive / NFS via path heuristics and refuse to run unless `--force` (sync overlays break `O_EXCL` and atomic rename).
- **IDs**: UUIDv7 via `uuidv7()` from `src/db/uuid.ts`. The 48-bit timestamp prefix is what `src/utils/v7-date.ts::dateForId` uses to derive the date subdir for threads and worker logs (pure function of the id).
- **Frontmatter** for tasks/schedules/prompts is strict-Zod-validated (`src/{tasks,schedules}/schema.ts`). Validation failures quarantine the file: log a structured warning and skip — never crash the worker.
- **Thread CSVs** are RFC-4180. The first row carries a `system / thread_meta` interaction whose `content` is a JSON blob with the thread's own metadata. `src/threads/store.ts` is the only writer; it handles escaping commas, quotes, and embedded newlines in agent output.

## DuckDB patterns (search-index sidecar only)

- **Connection lifecycle**: DuckDB holds the file lock at the *instance* level, so **no process holds a connection longer than one logical operation**. Always use `withDb(dbPath, async (conn) => { ... })` from `src/db/connection.ts` — it opens a conn, runs your callback, closes, and releases the OS lock. Never stash a `DbConnection` on a long-lived object.
- **`dbPath` is the currency**: long-lived callers (workers, chat session, TUI panels) hold `dbPath: string`, not `conn`. They open a fresh `withDb` per operation.
- **`src/db/embeddings.ts`** is the only DB CRUD module left; it takes `conn: DbConnection` as its first argument. Tests pass an in-memory conn directly.
- **Tools (`src/tools/*`)**: `ToolContext` has both `conn` (short-lived, scoped to this tool call) and `dbPath` (for long-running tools). Default to `ctx.conn`. For tools that take more than a couple seconds (e.g., `context_refresh` re-fetching many URLs), wrap DB touches in `await withDb(ctx.dbPath, ...)` so the lock releases between items.
- **Single batch writer**: `botholomew context reindex` acquires a process file lock and refuses to run while any worker pidfile is alive. Per-path reindex inside a worker is fine (sequential, in-process); cross-process concurrent rebuilds are not.
- **Retry**: `withRetry` (inside `withDb`) catches DuckDB "Conflicting lock" errors and backs off exponentially. Non-lock errors propagate immediately.
- **Migrations**: always call `migrate(conn)` after opening — it's idempotent. The migration set now drops the retired tables (tasks/schedules/threads/interactions/workers/context_items) so an old `index.duckdb` upgrades cleanly to the slim schema (`_migrations` + `context_index`).
- **Queries**: parameterized (`?1, ?2, ...`) — never string interpolation.
- **Vectors**: `FLOAT[384]` with `array_cosine_distance()`; no HNSW.
- **Full-text search**: BM25 over `context_index.chunk_content + title` via the `fts` extension. The FTS index is a snapshot — any writer must call `rebuildSearchIndex(conn)` after committing. The reindex pipeline (`src/context/reindex.ts`) is the only writer.

## Embeddings

- Embeddings run via `@huggingface/transformers` in **WASM** (`onnxruntime-web`), not the native `onnxruntime-node` bindings. The native bindings segfault under Bun when DuckDB is also loaded in the same process (see [oven-sh/bun#26081](https://github.com/oven-sh/bun/issues/26081)).
- The switch is enforced by a `bun patch` at `patches/@huggingface%2Ftransformers@<version>.patch` plus a `wasmPaths` override in `src/context/embedder-impl.ts` that points at the local `onnxruntime-web/dist/` files (no CDN fetch).
- **Bumping `@huggingface/transformers`**: re-run `bun patch '@huggingface/transformers@<version>'`, reapply the three edits to `src/backends/onnx.js` (kill the static `onnxruntime-node` import; in the `IS_NODE_ENV` branch, set `ONNX = ONNX_WEB` and use `['wasm']` for `supportedDevices`/`defaultDevices`), then `bun patch --commit`. The "coexists with DuckDB native module" test in `test/context/embedder.test.ts` is the regression guard.
- **mcpx alignment.** `@evantahler/mcpx` from v0.19.0 onward shares the same `@huggingface/transformers@^4.x` range, so Bun dedupes to one copy and our patch covers `mcp_search` automatically. If a future mcpx bump diverges (different major), expect chat-time crashes inside `mcp_search` and add a second patch for the nested copy.

## Testing

- **Tests are required**: all new features and bug fixes must include tests. `bun test` and `bun run lint` must pass before merging.
- Default to `setupTestDb()` from `test/helpers.ts` for in-memory tests — it calls `getConnection()` + `migrate(conn)`.
- Use `setupTestDbFile()` when a test needs to pass a `dbPath` to production code that opens/closes its own connections (worker `tick`, `processSchedules`, `runAgentLoop`, chat session, heartbeat/reaper). `:memory:` databases don't share state across `getConnection` calls, so a shared-file DB is required. Remember to call the returned `cleanup()` in `afterEach`.

## Documentation

- **Docs must track code.** Every PR that changes user-visible behavior must update the relevant doc(s). Treat docs as part of the code — not a follow-up task.
- The user-facing doc set lives under `docs/`, is published at [www.botholomew.com](https://www.botholomew.com) via VitePress + GitHub Pages, and is linked from `README.md`:
  - `docs/architecture.md` — workers, chat, registration + heartbeat + reaping, the disk layout, the search-index sidecar
  - `docs/automation.md` — cron, tmux, optional launchd/systemd for running workers on a schedule
  - `docs/files.md` — the `context/` sandbox (NFC + lstat-walk), file/dir tools, patch format
  - `docs/context-and-search.md` — ingestion pipeline, chunking, embeddings, hybrid search, reindex on write, remote loading agent
  - `docs/tasks-and-schedules.md` — task/schedule files (markdown + frontmatter), lockfile claim, DAG validation, predecessor outputs, LLM schedule evaluation
  - `docs/tools.md` — the `ToolDefinition` pattern (Zod → Anthropic + CLI)
  - `docs/prompts.md` — `prompts/{soul,beliefs,goals,capabilities}.md`, frontmatter, self-modification
  - `docs/skills.md` — slash-command skills, `$1` / `$ARGUMENTS` substitution, tab completion
  - `docs/mcpx.md` — `servers.json`, local servers vs. MCP gateways (Arcade), `mcp_*` meta-tools
  - `docs/configuration.md` — every key in `config.json`
  - `docs/tui.md` — the `botholomew chat` TUI: tabs, shortcuts, slash-command popup, message queue, streaming
- **When to update which doc:**
  - Touching `src/fs/sandbox.ts`, `src/fs/atomic.ts`, or `src/fs/compat.ts` → update `docs/files.md` and the "On-disk patterns" section in this file.
  - Touching `src/db/schema.ts` (the `context_index` table) → update `docs/context-and-search.md`.
  - Adding/renaming/removing a tool in `src/tools/` → update the relevant doc (`files.md` for `context_*` file/dir tools, `context-and-search.md` for search/refresh tools, thread tools in `architecture.md`, `tools.md` if the registry pattern changed) and the CLI reference table in `README.md`.
  - Adding a CLI subcommand in `src/commands/` → update the CLI table in `README.md` and the doc for that area.
  - Changing config defaults in `src/config/schemas.ts` → update `docs/configuration.md`.
  - Changing the tick loop, schedule evaluation, or agent loop (`src/worker/*`) → update `docs/architecture.md` and/or `docs/tasks-and-schedules.md`.
  - Changing worker registration, heartbeat, or reaping (`src/worker/heartbeat.ts`, `src/workers/store.ts`, `src/tasks/claim.ts`, `src/schedules/claim.ts`) → update `docs/architecture.md`.
  - Adding or renaming a skill template in `src/init/templates.ts` → update `docs/skills.md` and `src/init/index.ts`.
  - Changing prompts loading (`src/worker/prompt.ts`) → update `docs/prompts.md`.
  - Changing anything in `src/tui/` (new tab, new shortcut, input behavior) → update `docs/tui.md`.
  - Adding a new top-level doc under `docs/` → also add it to the sidebar in `docs/.vitepress/config.ts` so it's reachable from the published site.
- If a doc reference goes stale (links a renamed file, cites a removed behavior), fix it in the same PR — don't leave it for later.
- When adding a new top-level feature, add a new doc under `docs/` and link it from the "Deep dives" section of `README.md` and the sidebar in `docs/.vitepress/config.ts`.
- Never claim a feature exists that isn't implemented. If something is planned, say so and link to the milestone under `docs/plans/`.
- Site build: `bun run docs:dev` for local preview, `bun run docs:build` for the static site (output: `docs/.vitepress/dist`). The `docs-build` CI job validates every PR; `docs-deploy` publishes on push to `main`.
