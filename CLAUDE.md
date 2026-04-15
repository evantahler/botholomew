# Botholomew

An AI agent for knowledge work. See `docs/plans/README.md` for the milestone roadmap.

## Project Structure

- `src/` — TypeScript source code
  - `cli.ts` — CLI entrypoint (Commander.js)
  - `commands/` — CLI subcommand handlers
  - `config/` — Configuration loading/schemas
  - `daemon/` — Daemon tick loop, LLM integration, prompt building
  - `db/` — SQLite connection (bun:sqlite), schema migrations, CRUD modules
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
- **Database**: SQLite (`bun:sqlite`)
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

- **Connection**: use `DbConnection` type from `src/db/connection.ts` (re-export of `bun:sqlite` `Database`)
- **Migrations**: always call `migrate(db)` after opening a connection — it's idempotent
- **IDs**: UUIDv7 generated in application code via `uuidv7()` from `src/db/uuid.ts` (re-exports `uuid` package)
- **Queries**: use parameterized queries (`?1, ?2, ...`) — never string interpolation
- **Timestamps**: stored as ISO 8601 TEXT in SQLite (`datetime('now')`), converted to `Date` objects in TypeScript interfaces
- **Booleans**: stored as INTEGER (0/1) in SQLite, converted to `boolean` in TypeScript
- **Arrays**: `blocked_by`/`context_ids` are JSON TEXT columns — `JSON.stringify()` on write, `JSON.parse()` on read, `json_each()` for in-SQL filtering
- **Row mapping**: each module has a `RowType` interface (raw SQLite strings/numbers) and a `rowToX()` function that converts to the public TypeScript interface with proper types

## Testing

- **Tests are required**: all new features and bug fixes must include tests. `bun test` and `bun run lint` must pass before merging.
- Use `getConnection(":memory:")` for in-memory test databases
- Call `migrate(conn)` in `beforeEach` to get a fresh schema each test
