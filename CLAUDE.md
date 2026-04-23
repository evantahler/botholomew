# Botholomew

An AI agent for knowledge work. See `docs/plans/README.md` for the milestone roadmap.

## Project Structure

- `src/` — TypeScript source code
  - `cli.ts` — CLI entrypoint (Commander.js)
  - `commands/` — CLI subcommand handlers
  - `config/` — Configuration loading/schemas
  - `worker/` — Worker tick loop, LLM integration, prompt building, heartbeat
  - `db/` — DuckDB connection (`@duckdb/node-api`), schema migrations, CRUD modules
  - `init/` — Project initialization
  - `tui/` — Ink (React) TUI components
  - `utils/` — Logger, frontmatter
- `test/` — Tests (mirrors src/ structure)
- `docs/plans/` — Milestone plans and roadmap

## Commands

- `bun test` — Run all tests
- `bun run dev` — Run the CLI in development
- `bun run build` — Compile to standalone binary

## Tech Stack

- **Runtime**: Bun + TypeScript
- **Database**: DuckDB (`@duckdb/node-api`) with VSS extension for vector search
- **LLM**: Anthropic SDK (`@anthropic-ai/sdk`)
- **CLI**: Commander.js
- **TUI**: Ink 6 + React 19
- **Tools**: MCPX

## Conventions

- **Always use `bun`** — never use `npm`, `npx`, `yarn`, or `node`. This is a Bun project: `bun install`, `bun test`, `bun run <script>`, `bunx` for one-off binaries.
- Bump `version` in `package.json` for every change merged to `main` — the auto-release workflow uses this to determine when to publish
- Run `bun run lint` and `bun test` before committing
- `bun run lint` runs both `tsc --noEmit` and `biome check`
- All database access goes through `src/db/` modules
- All agent interactions are logged to the threads/interactions tables
- **List operations always support `-l, --limit <n>` and `-o, --offset <n>`** — applies to every CLI `list` subcommand and the corresponding `src/db/` list function. Use `sanitizeInt` on both when interpolating into SQL, and pick a stable `ORDER BY` (with an `id` tiebreaker) so pagination is deterministic.
- No filesystem tools for the agent — FS access is abstracted through CRUD modules scoped to `.botholomew/`
- When designing or modifying agent tools, follow PATs (Patterns for Agentic Tools): https://arcade.dev/patterns/llm.txt — key principles: error-guided recovery, next-action hints, token-efficient outputs, error classification
- **Tool descriptions mirror bash when applicable** — if an LLM tool behaves like a familiar CLI command (e.g., `cat`, `ls`, `mv`, `grep`), prefix its `description` with `[[ bash equivalent command: <cmd> ]] ` followed by the short description. This anchors the tool for the model and keeps the tag machine-parseable. Omit the tag for tools with no natural bash analog (e.g., `update_beliefs`, `read_large_result`).

## Database Patterns

- **Connection lifecycle**: DuckDB holds the file lock at the *instance* level, so **no process holds a connection longer than one logical operation**. Always use `withDb(dbPath, async (conn) => { ... })` from `src/db/connection.ts` — it opens a conn, runs your callback, closes, and releases the OS lock. Never stash a `DbConnection` on a long-lived object (worker tick, chat session, TUI component state).
- **`dbPath` is the currency**: long-lived callers (workers, chat session, TUI panels) hold `dbPath: string`, not `conn`. They open a fresh `withDb` per operation.
- **CRUD modules in `src/db/*`**: still take `conn: DbConnection` as their first argument. Callers supply one via `withDb`. Don't change these signatures to `dbPath` — tests pass an in-memory conn directly, which wouldn't survive a `withDb` (separate `:memory:` instances don't share state).
- **Tools (`src/tools/*`)**: `ToolContext` has both `conn` (short-lived, scoped to this tool call) and `dbPath` (for long-running tools). Default to `ctx.conn`. For tools that take more than a couple seconds (e.g., `context_refresh` re-fetching many URLs), wrap DB touches in `await withDb(ctx.dbPath, ...)` so the lock releases between items.
- **Transactions**: `BEGIN / COMMIT / ROLLBACK` must all run on the **same** `conn`. Keep the whole transaction inside one `withDb` block.
- **Retry**: `withRetry` (inside `withDb`) catches DuckDB "Conflicting lock" errors and backs off exponentially (100, 200, 400 … up to 8 tries ≈ 25 s). Non-lock errors propagate immediately.
- **Parallel tool calls**: safe. Overlapping `withDb` calls in one process share a refcounted instance; DuckDB's "don't open the same DB twice in a process" rule stays satisfied, and the OS lock releases once every overlapping caller has closed.
- **Migrations**: always call `migrate(conn)` after opening — it's idempotent. In entrypoints, do it once in a short `withDb` at startup (worker, chat, CLI via `src/commands/with-db.ts`).
- **IDs**: UUIDv7 generated in application code via `uuidv7()` from `src/db/uuid.ts` (re-exports `uuid` package)
- **Queries**: use parameterized queries (`?1, ?2, ...`) — never string interpolation (auto-translated to `$N` for DuckDB)
- **Timestamps**: stored as ISO 8601 TEXT (`datetime('now')`), converted to `Date` objects in TypeScript interfaces
- **Booleans**: stored as INTEGER (0/1) in DuckDB, converted to `boolean` in TypeScript
- **Arrays**: `blocked_by`/`context_ids` are JSON TEXT columns — `JSON.stringify()` on write, `JSON.parse()` on read
- **Vectors**: embedding columns use DuckDB's native `FLOAT[N]` array type with HNSW indexes and `array_cosine_distance()` for similarity search
- **Row mapping**: each module has a `RowType` interface (raw DuckDB values) and a `rowToX()` function that converts to the public TypeScript interface with proper types

## Testing

- **Tests are required**: all new features and bug fixes must include tests. `bun test` and `bun run lint` must pass before merging.
- Default to `setupTestDb()` from `test/helpers.ts` for in-memory tests — it calls `getConnection()` + `migrate(conn)`.
- Use `setupTestDbFile()` when a test needs to pass a `dbPath` to production code that opens/closes its own connections (worker `tick`, `processSchedules`, `runAgentLoop`, chat session, heartbeat/reaper). `:memory:` databases don't share state across `getConnection` calls, so a shared-file DB is required. Remember to call the returned `cleanup()` in `afterEach`.

## Documentation

- **Docs must track code.** Every PR that changes user-visible behavior must update the relevant doc(s). Treat docs as part of the code — not a follow-up task.
- The user-facing doc set lives under `docs/` and is linked from `README.md`:
  - `docs/architecture.md` — workers, chat, registration + heartbeat + reaping, shared DB
  - `docs/automation.md` — cron, tmux, optional launchd/systemd for running workers on a schedule
  - `docs/virtual-filesystem.md` — DuckDB-as-filesystem, `file_*` / `dir_*` tools, patch format
  - `docs/context-and-search.md` — ingestion pipeline, chunking, embeddings, hybrid search, remote loading agent, `context refresh`
  - `docs/tasks-and-schedules.md` — task lifecycle, DAG validation, predecessor outputs, LLM schedule evaluation
  - `docs/tools.md` — the `ToolDefinition` pattern (Zod → Anthropic + CLI)
  - `docs/persistent-context.md` — `soul.md` / `beliefs.md` / `goals.md`, frontmatter, self-modification
  - `docs/skills.md` — slash-command skills, `$1` / `$ARGUMENTS` substitution, tab completion
  - `docs/mcpx.md` — `servers.json`, local servers vs. MCP gateways (Arcade), `mcp_*` meta-tools
  - `docs/configuration.md` — every key in `config.json`
  - `docs/tui.md` — the `botholomew chat` TUI: tabs, shortcuts, slash-command popup, message queue, streaming
- **When to update which doc:**
  - Touching `src/db/sql/*.sql` or `src/db/schema.ts` → update `docs/virtual-filesystem.md` and/or `docs/context-and-search.md` with any new columns, tables, or indexes.
  - Changing connection lifecycle or `withDb` semantics in `src/db/connection.ts` → update the "Connection model" section in `docs/architecture.md` and the "Database Patterns" section in this file.
  - Adding/renaming/removing a tool in `src/tools/` → update the relevant doc (`virtual-filesystem.md` for file/dir tools, `context-and-search.md` for search tools, `tools.md` if the registry pattern changed) and the CLI reference table in `README.md`.
  - Adding a CLI subcommand in `src/commands/` → update the CLI table in `README.md` and the doc for that area.
  - Changing config defaults in `src/config/schemas.ts` → update `docs/configuration.md`.
  - Changing the tick loop, schedule evaluation, or agent loop (`src/worker/*`) → update `docs/architecture.md` and/or `docs/tasks-and-schedules.md`.
  - Changing worker registration, heartbeat, or reaping (`src/worker/heartbeat.ts`, `src/db/workers.ts`) → update `docs/architecture.md`.
  - Adding or renaming a skill template in `src/init/templates.ts` → update `docs/skills.md` and `src/init/index.ts`.
  - Changing anything in persistent-context loading (`src/worker/prompt.ts`) → update `docs/persistent-context.md`.
  - Changing anything in `src/tui/` (new tab, new shortcut, input behavior) → update `docs/tui.md`.
- If a doc reference goes stale (links a renamed file, cites a removed behavior), fix it in the same PR — don't leave it for later.
- When adding a new top-level feature, add a new doc under `docs/` and link it from the "Deep dives" section of `README.md`.
- Never claim a feature exists that isn't implemented. If something is planned, say so and link to the milestone under `docs/plans/`.
