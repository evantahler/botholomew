# Botholomew

An AI agent for knowledge work. See `docs/plans/README.md` for the milestone roadmap.

## Project Structure

- `src/` — TypeScript source code
  - `cli.ts` — CLI entrypoint (Commander.js)
  - `commands/` — CLI subcommand handlers
  - `config/` — Configuration loading/schemas
  - `daemon/` — Daemon tick loop, LLM integration, prompt building
  - `db/` — DuckDB connection (`@duckdb/node-api`), schema migrations, CRUD modules
  - `init/` — Project initialization
  - `tui/` — Ink (React) TUI components
  - `utils/` — Logger, frontmatter, PID management
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
- No filesystem tools for the agent — FS access is abstracted through CRUD modules scoped to `.botholomew/`
- When designing or modifying agent tools, follow PATs (Patterns for Agentic Tools): https://arcade.dev/patterns/llm.txt — key principles: error-guided recovery, next-action hints, token-efficient outputs, error classification

## Database Patterns

- **Connection**: use `DbConnection` type from `src/db/connection.ts` (wrapper around `@duckdb/node-api`)
- **Migrations**: always call `migrate(db)` after opening a connection — it's idempotent
- **IDs**: UUIDv7 generated in application code via `uuidv7()` from `src/db/uuid.ts` (re-exports `uuid` package)
- **Queries**: use parameterized queries (`?1, ?2, ...`) — never string interpolation (auto-translated to `$N` for DuckDB)
- **Timestamps**: stored as ISO 8601 TEXT (`datetime('now')`), converted to `Date` objects in TypeScript interfaces
- **Booleans**: stored as INTEGER (0/1) in DuckDB, converted to `boolean` in TypeScript
- **Arrays**: `blocked_by`/`context_ids` are JSON TEXT columns — `JSON.stringify()` on write, `JSON.parse()` on read
- **Vectors**: embedding columns use DuckDB's native `FLOAT[N]` array type with HNSW indexes and `array_cosine_distance()` for similarity search
- **Row mapping**: each module has a `RowType` interface (raw DuckDB values) and a `rowToX()` function that converts to the public TypeScript interface with proper types

## Testing

- **Tests are required**: all new features and bug fixes must include tests. `bun test` and `bun run lint` must pass before merging.
- Use `getConnection(":memory:")` for in-memory test databases
- Call `migrate(conn)` in `beforeEach` to get a fresh schema each test

## Documentation

- **Docs must track code.** Every PR that changes user-visible behavior must update the relevant doc(s). Treat docs as part of the code — not a follow-up task.
- The user-facing doc set lives under `docs/` and is linked from `README.md`:
  - `docs/architecture.md` — daemon, chat, watchdog, shared DB
  - `docs/virtual-filesystem.md` — DuckDB-as-filesystem, `file_*` / `dir_*` tools, patch format
  - `docs/context-and-search.md` — ingestion pipeline, chunking, embeddings, hybrid search, remote loading agent, `context refresh`
  - `docs/tasks-and-schedules.md` — task lifecycle, DAG validation, predecessor outputs, LLM schedule evaluation
  - `docs/tools.md` — the `ToolDefinition` pattern (Zod → Anthropic + CLI)
  - `docs/persistent-context.md` — `soul.md` / `beliefs.md` / `goals.md`, frontmatter, self-modification
  - `docs/skills.md` — slash-command skills, `$1` / `$ARGUMENTS` substitution, tab completion
  - `docs/mcpx.md` — `servers.json`, local servers vs. MCP gateways (Arcade), `mcp_*` meta-tools
  - `docs/watchdog.md` — launchd/systemd, healthcheck, multi-project naming
  - `docs/configuration.md` — every key in `config.json`
- **When to update which doc:**
  - Touching `src/db/sql/*.sql` or `src/db/schema.ts` → update `docs/virtual-filesystem.md` and/or `docs/context-and-search.md` with any new columns, tables, or indexes.
  - Adding/renaming/removing a tool in `src/tools/` → update the relevant doc (`virtual-filesystem.md` for file/dir tools, `context-and-search.md` for search tools, `tools.md` if the registry pattern changed) and the CLI reference table in `README.md`.
  - Adding a CLI subcommand in `src/commands/` → update the CLI table in `README.md` and the doc for that area.
  - Changing config defaults in `src/config/schemas.ts` → update `docs/configuration.md`.
  - Changing the tick loop, schedule evaluation, or agent loop (`src/daemon/*`) → update `docs/architecture.md` and/or `docs/tasks-and-schedules.md`.
  - Adding or renaming a skill template in `src/init/templates.ts` → update `docs/skills.md` and `src/init/index.ts`.
  - Changing watchdog install behavior (`src/daemon/watchdog.ts`, `healthcheck.ts`) → update `docs/watchdog.md`.
  - Changing anything in persistent-context loading (`src/daemon/prompt.ts`) → update `docs/persistent-context.md`.
- If a doc reference goes stale (links a renamed file, cites a removed behavior), fix it in the same PR — don't leave it for later.
- When adding a new top-level feature, add a new doc under `docs/` and link it from the "Deep dives" section of `README.md`.
- Never claim a feature exists that isn't implemented. If something is planned, say so and link to the milestone under `docs/plans/`.
