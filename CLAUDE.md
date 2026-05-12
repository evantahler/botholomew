# Botholomew

An AI agent for knowledge work. See `docs/plans/README.md` for the milestone roadmap.

## Project Structure

- `src/` — TypeScript source code
  - `cli.ts` — CLI entrypoint (Commander.js)
  - `constants.ts` — Project-layout constants (dir names, `getWorkerLogPath`, `PROTECTED_AREAS`); the header comment is the canonical on-disk tree
  - `commands/` — CLI subcommand handlers (the `membot` group is a thin passthrough to the `membot` CLI)
  - `config/` — Configuration loading/schemas
  - `fs/` — Path sandbox (`resolveInRoot`), atomic-write/lockfile helpers, sync-overlay-FS detector, shared line-patch helper
  - `mem/` — Per-project `MembotClient` singleton (`openMembot(projectDir)`)
  - `prompts/` — Capabilities scanner that regenerates `prompts/capabilities.md`
  - `tasks/` — Task frontmatter schema, file CRUD, lockfile-based claim
  - `schedules/` — Same shape as tasks, on `schedules/<id>.md`
  - `threads/` — CSV-backed conversation log (`threads/<YYYY-MM-DD>/<id>.csv`)
  - `workers/` — Pidfile + heartbeat store under `workers/<id>.json`
  - `worker/` — Worker tick loop, LLM integration, prompt building, heartbeat
  - `chat/` — Interactive chat session + agent loop powering `botholomew chat`
  - `tools/` — Tool registry and `ToolDefinition`s (`membot_*` adapters, task/schedule/thread/mcp/prompt/skill/worker/capabilities tools)
  - `mcpx/` — MCPX client for invoking external MCP servers
  - `skills/` — Slash-command skill loader, parser, and writer
  - `init/` — Project initialization
  - `tui/` — Ink (React) TUI components
  - `update/` — Self-update checker and background cache
  - `types/` — Shared TypeScript ambient declarations
  - `utils/` — Logger, frontmatter, uuid, v7-date helpers
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
- **Knowledge store**: [`membot`](https://github.com/evantahler/membot) — owns `<projectDir>/index.duckdb`, the ingestion pipeline (PDF/DOCX/HTML → markdown, local WASM embeddings, hybrid BM25 + semantic search), append-only versioning, and URL fetchers.
- **On-disk state we own**: markdown w/ frontmatter for tasks/schedules/prompts/skills; CSV for threads; JSON for worker pidfiles.
- **LLM**: Anthropic SDK (`@anthropic-ai/sdk`)
- **CLI**: Commander.js
- **TUI**: Ink 7 + React 19
- **External tools**: MCPX

## Conventions

- **Always use `bun`** — never use `npm`, `npx`, `yarn`, or `node`. This is a Bun project: `bun install`, `bun test`, `bun run <script>`, `bunx` for one-off binaries.
- Bump `version` in `package.json` for every change merged to `main` — the auto-release workflow uses this to determine when to publish. **Exception**: docs-only changes (anything under `docs/`, plus `README.md`) do not need a version bump, since they don't affect the published binary.
- Run `bun run lint` and `bun test` before committing
- `bun run lint` runs both `tsc --noEmit` and `biome check`
- Each on-disk area has its own store module: `src/tasks/store.ts`, `src/schedules/store.ts`, `src/threads/store.ts`, `src/workers/store.ts`. The knowledge store has no in-tree CRUD module — agent tools call into it via `ctx.withMem((mem) => …)`, a scope-bound `MembotClient` accessor.
- All path-taking tools route through `src/fs/sandbox.ts::resolveInRoot` — no exceptions
- All agent interactions are logged to the thread CSV at `threads/<YYYY-MM-DD>/<id>.csv`
- **List operations always support `-l, --limit <n>` and `-o, --offset <n>`** — applies to every CLI `list` subcommand and every list function in `src/{tasks,schedules,threads,workers}/store.ts`. Pick a stable sort (typically newest-first by `id`, since uuidv7 is time-ordered) so pagination is deterministic.
- The agent has no shell. Knowledge access is exposed through `membot_*` tools that wrap `ctx.withMem`; tasks, schedules, prompts, skills, and threads have their own typed tools.
- When designing or modifying agent tools, follow PATs (Patterns for Agentic Tools): https://arcade.dev/patterns/llm.txt — key principles: error-guided recovery, next-action hints, token-efficient outputs, error classification
- **Tool descriptions mirror bash when applicable** — if an LLM tool behaves like a familiar CLI command (e.g., `cat`, `ls`, `mv`, `grep`), prefix its `description` with `[[ bash equivalent command: <cmd> ]] ` followed by the short description. This anchors the tool for the model and keeps the tag machine-parseable. Membot ops already follow this convention upstream; the Botholomew adapter passes their descriptions through verbatim.
- **Unified line-patch edits.** Resource-edit tools (`task_edit`, `schedule_edit`, `prompt_edit`, `skill_edit`, `membot_edit`) all use the same git-hunk-style patch from `src/fs/patches.ts` — `LinePatchSchema` (`{start_line, end_line, content}`) plus `applyLinePatches`. Reuse this for any new edit tool; don't invent a parallel shape.
- **Prompts are a generic markdown bag.** Every `prompts/*.md` is treated identically by `src/worker/prompt.ts` — `init` only seeds `goals.md`, `beliefs.md`, `capabilities.md` as a starting point, but they are not special-cased. Frontmatter (`title`, `loading`, `agent-modification`) is strict-validated in `src/utils/frontmatter.ts` and failures **fast-fail** (abort the worker / chat turn) rather than quarantine, since prompts shape the agent's reasoning. Tasks/schedules keep the existing quarantine behavior. Full CRUD is exposed via `botholomew prompts *` and `prompt_*` agent tools.

## On-disk patterns

- **Project root is the cwd.** `botholomew init` writes its tree at `<cwd>/{config,prompts,skills,mcpx,tasks,schedules,threads,workers,logs}`. There is no `.botholomew/` wrapper. The membot knowledge store (`index.duckdb`) and the seeded mcpx `servers.json` are only written into `<cwd>` when `membot_scope` / `mcpx_scope` in `config/config.json` is `"project"`; the default is `"global"`, which resolves to `~/.membot/` and `~/.mcpx/` (shared across every project on the machine). Pass `--membot-scope=project` / `--mcpx-scope=project` to `botholomew init` to opt out per project.
- **Path sandbox is non-negotiable.** Every tool that takes a `path` arg routes through `src/fs/sandbox.ts::resolveInRoot(root, userPath, opts)`. NFC-normalize, reject NUL/`..`/absolute, lstat-walk every component. By default symlink components are rejected. Tasks, schedules, prompts, and skills all depend on this helper. (Membot owns its own path semantics for `logical_path`, which is a DB key — not a filesystem path.)
- **Atomic-write-via-rename for status mutations.** `src/fs/atomic.ts::atomicWrite` writes a `*.tmp.<wid>` then `fs.rename`s. Reads-before-writes (tasks/schedules/prompts) compare the file's `mtime` between read and write — abort and retry if it changed.
- **`O_EXCL` lockfiles** for tasks and schedules. Body holds the worker id and `claimed_at`. Release = `unlink`. Reaper walks the lock dirs and unlinks orphans whose owner is dead in `workers/`.
- **Filesystem compatibility**: `init` and worker startup detect iCloud / Dropbox / OneDrive / NFS via path heuristics and refuse to run unless `--force` (sync overlays break `O_EXCL` and atomic rename — the only place we still rely on those guarantees is task/schedule claim).
- **IDs**: UUIDv7 via `uuidv7()` from `src/utils/uuid.ts`. The 48-bit timestamp prefix is what `src/utils/v7-date.ts::dateForId` uses to derive the date subdir for threads and worker logs (pure function of the id).
- **Frontmatter** for tasks/schedules is strict-Zod-validated (`src/{tasks,schedules}/schema.ts`). Validation failures quarantine the file: log a structured warning and skip — never crash the worker. Prompts use the same frontmatter pattern but **fast-fail** (see Conventions below).
- **Thread CSVs** are RFC-4180. The first row carries a `system / thread_meta` interaction whose `content` is a JSON blob with the thread's own metadata. `src/threads/store.ts` is the only writer; it handles escaping commas, quotes, and embedded newlines in agent output.

## Knowledge store (membot)

- **One `MembotClient` per process.** `src/mem/client.ts::openMembot(dataDir)` takes a resolved data directory. Callers compute it with `resolveMembotDir(projectDir, config)`: `"global"` → `~/.membot`, `"project"` → `<projectDir>`. Workers, chat sessions, TUI panels, and init each call this pair on startup. The default scope is `"global"`, so a fresh project shares knowledge with every other project on the machine unless the user opts out. The same shape exists for mcpx (`createMcpxClient(mcpxDir)` + `resolveMcpxDir(projectDir, config)` in `src/mcpx/client.ts`).
- **`ToolContext.mem` is the only handle the agent sees.** Every `membot_*` tool routes through it. Membot manages its DuckDB lock per-op so multiple in-process consumers (worker + chat + TUI panel) share the file safely.
- **No direct DuckDB access from Botholomew.** We don't import `@duckdb/node-api` or `@huggingface/transformers`. Every DB / embedding concern lives behind the membot SDK.
- **Agent tools live in `src/tools/membot/`.** `adapter.ts` turns each upstream membot `Operation` into a Botholomew `ToolDefinition`; `edit.ts`, `copy.ts`, `exists.ts`, `count_lines.ts`, and `pipe.ts` add the file-shaped UX our agents already know (git-hunk patches, presence checks, etc.) on top of membot's whole-file `write`.
- **CLI passthrough.** `botholomew membot <args…>` spawns `membot <args…> --config <resolvedDir>` (resolved from `membot_scope`); `botholomew mcpx <args…>` spawns `mcpx <args…> -c <resolvedDir>` (from `mcpx_scope`). Both forward stdio. There is no Botholomew-side `membot_*` command implementation. The Botholomew-specific `membot import-global` / `mcpx import-global` always copy into the **project** dir (so users can seed a project store before flipping scope to `"project"`).

## Testing

- **Tests are required**: all new features and bug fixes must include tests. `bun test` and `bun run lint` must pass before merging.
- For tests that need a real membot store, use `setupTestMembot()` from `test/helpers.ts` — it spins up a per-test temp dir, opens a `MembotClient`, and returns a `cleanup()` that closes the client and removes the temp dir. Always call `cleanup()` in `afterEach`.
- For pure tool-context tests that don't actually exercise membot, you can pass `withMem: null as never` to `ToolContext` — the type checker accepts it and the tool body never reaches it.

## Documentation

- **Docs must track code.** Every PR that changes user-visible behavior must update the relevant doc(s). Treat docs as part of the code — not a follow-up task.
- The user-facing doc set lives under `docs/`, is published at [www.botholomew.com](https://www.botholomew.com) via VitePress + GitHub Pages, and is linked from `README.md`. Keep the sidebar in `docs/.vitepress/config.ts` in sync when adding or moving a doc:
  - `docs/index.md` — landing page
  - `docs/getting-started.md` — install & quickstart
  - `docs/architecture.md` — workers, chat, registration + heartbeat + reaping, the disk layout, the membot dependency
  - `docs/automation.md` — cron, tmux, optional launchd/systemd for running workers on a schedule
  - `docs/files.md` — the membot knowledge store (logical_path, versioning, append-only history, `membot_*` tools, patch format)
  - `docs/context-and-search.md` — pointer to membot for ingestion / chunking / embeddings / hybrid search
  - `docs/tasks-and-schedules.md` — task/schedule files (markdown + frontmatter), lockfile claim, DAG validation, predecessor outputs, LLM schedule evaluation
  - `docs/tools.md` — the `ToolDefinition` pattern (Zod → Anthropic + CLI)
  - `docs/prompts.md` — generic `prompts/*.md` (init seeds `goals.md`, `beliefs.md`, `capabilities.md`), strict frontmatter validation, CRUD via CLI + agent tools
  - `docs/skills.md` — slash-command skills, `$1` / `$ARGUMENTS` substitution, tab completion
  - `docs/mcpx.md` — `servers.json`, local servers vs. MCP gateways (Arcade), `mcp_*` meta-tools
  - `docs/configuration.md` — every key in `config.json`
  - `docs/tui.md` — the `botholomew chat` TUI: tabs, shortcuts, slash-command popup, message queue, streaming
  - `docs/captures.md` — terminal recordings (VHS tapes) used as media in the docs site
  - `docs/owl-character-sheet.md` — Botholomew's persona reference (used to seed prompts)
  - `docs/changelog.md` — release notes
- **When to update which doc:**
  - Touching `src/fs/sandbox.ts`, `src/fs/atomic.ts`, or `src/fs/compat.ts` → update the "On-disk patterns" section above and any doc that explains the relevant invariant.
  - Touching `src/mem/client.ts` or any `src/tools/membot/*` → update `docs/files.md` and the "Knowledge store" section above.
  - Adding/renaming/removing a tool in `src/tools/` → update the relevant doc (`files.md` for `membot_*`, thread tools in `architecture.md`, `tools.md` if the registry pattern changed) and the CLI reference table in `README.md`.
  - Adding a CLI subcommand in `src/commands/` → update the CLI table in `README.md` and the doc for that area.
  - Changing config defaults in `src/config/schemas.ts` → update `docs/configuration.md`.
  - Changing the tick loop, schedule evaluation, or agent loop (`src/worker/*`) → update `docs/architecture.md` and/or `docs/tasks-and-schedules.md`.
  - Changing worker registration, heartbeat, or reaping (`src/worker/heartbeat.ts`, `src/workers/store.ts`) or task/schedule claim logic (`src/tasks/store.ts`, `src/schedules/store.ts`) → update `docs/architecture.md`.
  - Adding or renaming a skill template in `src/init/templates.ts` → update `docs/skills.md` and `src/init/index.ts`.
  - Changing prompts loading or frontmatter schema (`src/worker/prompt.ts`, prompt validation in `src/utils/frontmatter.ts`) → update `docs/prompts.md`.
  - Changing anything in `src/tui/` (new tab, new shortcut, input behavior) → update `docs/tui.md`.
  - Adding a new top-level doc under `docs/` → also add it to the sidebar in `docs/.vitepress/config.ts` so it's reachable from the published site.
- If a doc reference goes stale (links a renamed file, cites a removed behavior), fix it in the same PR — don't leave it for later.
- When adding a new top-level feature, add a new doc under `docs/` and link it from the "Deep dives" section of `README.md` and the sidebar in `docs/.vitepress/config.ts`.
- Never claim a feature exists that isn't implemented. If something is planned, say so and link to the milestone under `docs/plans/`.
- Site build: `bun run docs:dev` for local preview, `bun run docs:build` for the static site (output: `docs/.vitepress/dist`). The `docs-build` CI job validates every PR; `docs-deploy` publishes on push to `main`.
