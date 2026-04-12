# Botholomew

An AI agent for knowledge work. See `docs/plans/README.md` for the milestone roadmap.

## Project Structure

- `src/` — TypeScript source code
  - `cli.ts` — CLI entrypoint (Commander.js)
  - `commands/` — CLI subcommand handlers
  - `config/` — Configuration loading/schemas
  - `daemon/` — Daemon tick loop, LLM integration, prompt building
  - `db/` — DuckDB connection, schema migrations, CRUD modules
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
- **Database**: DuckDB (`@duckdb/node-api`)
- **LLM**: Anthropic SDK (`@anthropic-ai/sdk`)
- **CLI**: Commander.js
- **TUI**: Ink 6 + React 19
- **Tools**: MCPX

## Conventions

- Use `bun test` before committing
- All database access goes through `src/db/` modules
- All agent interactions are logged to the threads/interactions tables
- No filesystem tools for the agent — FS access is abstracted through CRUD modules scoped to `.botholomew/`
