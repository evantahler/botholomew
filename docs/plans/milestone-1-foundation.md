# Botholomew

An AI Agent for knowledge work. Unlike coding agents, Botholomew is focused on information management, research, organization, and intellectual tasks.

## Core Principles

1. **No shell / filesystem access.** The agent has no bash, read/write, or direct filesystem tools. All storage is abstracted through manage-context tools scoped to `.botholomew/`.
2. **Distributed from the start.** Orchestrator, tool execution, memory, and context are separate modules, making it possible to run locally and on the web.
3. **TUI interface.** A terminal UI built with Ink (React for CLI), styled after Claude Code.
4. **It's all files.** Each Botholomew project is a collection of markdown and a DuckDB database — portable and shareable.

---

## Architecture

### Daemon

A long-running Bun process per project. It wakes, ticks (works one task or processes schedules), sleeps for `TICK_FREQUENCY`, and repeats. A separate OS-level watchdog (launchd on macOS, systemd on Linux) fires every minute via cron to check if the daemon PID is alive and restart it if not.

### Chat

The interactive TUI session. The chat agent doesn't work tasks itself — it enqueues them for the daemon. It has full read access to all results, context, and interaction history built up by the daemon.

### Data

Both daemon and chat share the same DuckDB database at `.botholomew/data.duckdb`. Each opens its own connection. A retry-on-lock layer handles write contention.

---

## Tools

All tools are executed via MCPX ([github.com/evantahler/mcpx](https://github.com/evantahler/mcpx)), imported as a TypeScript library. This allows the operator to manually add/remove tools and have a first-class MCP experience. Each project has a custom MCPX registry at `.botholomew/mcpx/servers.json`.

---

## Persistent Context

The `.botholomew/` directory contains markdown files with YAML frontmatter:

```yaml
---
loading: always | contextual
agent-modification: true | false
---
```

- **`loading: always`** — included in every system prompt
- **`loading: contextual`** — included when keywords/semantic match triggers relevance, plus the agent can explicitly search for more
- **`agent-modification: true`** — the daemon can modify this file

New projects start with:
- `soul.md` — always loaded, NOT agent-editable (defines the agent's identity)
- `beliefs.md` — always loaded, agent-editable (things learned about the world/project)
- `goals.md` — always loaded, agent-editable (current goals)

---

## Dynamic Context (DuckDB)

The `.botholomew/data.duckdb` file powers tasks, schedules, context, embeddings, and interaction logs.

### Tasks

TODOs the agent or human creates. When the daemon wakes, it claims the highest-priority unblocked pending task and works it.

Fields: `id`, `name`, `description`, `priority` (low/medium/high), `status` (pending/in_progress/failed/complete/waiting), `waiting_reason`, `claimed_by`, `claimed_at`, `blocked_by` (array of task IDs), `context_ids` (array of context item IDs), `created_at`, `updated_at`.

Circular dependency DAGs are rejected at enqueue time. The agent can reset tasks that are taking too long.

### Schedules

Recurring work items that enqueue tasks when due (e.g., "check my email every morning" produces "read email" and "produce summary" tasks).

Fields: `id`, `name`, `description`, `frequency` (plain text, not cron — e.g., "every morning"), `last_run_at`, `enabled`, `created_at`, `updated_at`.

### Context

A hybrid search system with chunking. Context items live in a virtual folder structure and can be textual (markdown, text) or binary (pdf, image). The agent can produce context from tool use or the operator can provide it via `botholomew context add`.

Context is stored in the database (not raw files), with:
- `id`, `title`, `description` (LLM-generated), `content` (text) or `content_blob` (binary), `mime_type`, `is_textual`, `source_path` (origin URL/path), `context_path` (virtual filesystem path), `indexed_at`, `created_at`, `updated_at`

Content is chunked and vectorized locally using `@huggingface/transformers` with `Xenova/bge-small-en-v1.5` (384-dimensional embeddings). Chunking strategy is determined by the LLM after reading each piece of content.

Embeddings are stored as JSON arrays in TEXT columns and searched via brute-force cosine similarity for hybrid keyword + vector search.

Embedding fields: `id`, `context_item_id`, `chunk_index`, `chunk_content`, `title`, `description`, `source_path`, `embedding` (JSON array of 384 floats), `created_at`.

### Threads & Interactions (Logging)

Every agent interaction — daemon ticks and chat sessions — is logged for debuggability.

**Threads** represent a session:
- `id`, `type` (daemon_tick/chat_session), `task_id` (FK, null for chats), `title`, `started_at`, `ended_at`, `metadata` (JSON — model, config snapshot, etc.)

**Interactions** are individual entries within a thread:
- `id`, `thread_id` (FK), `sequence` (ordering), `role` (user/assistant/system/tool), `kind` (message/thinking/tool_use/tool_result/context_update/status_change), `content`, `tool_name`, `tool_input` (JSON), `duration_ms`, `token_count`, `created_at`

Logging flow:
1. Each daemon tick or chat session creates a thread
2. Every message, thinking block, tool call, tool result, and status change is logged as an interaction
3. Thread `ended_at` is set when the tick/session completes

---

## System Prompt

Static, explaining what the agent is and that it should work the task/schedule system on each tick. Includes:
- Current date/time, current user, current directory
- Botholomew info (version, OS, platform)
- All "always" loaded persistent context files
- Available tools and instructions for task lifecycle

---

## Configuration

`.botholomew/config.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `anthropic_api_key` | (env var) | API key. `ANTHROPIC_API_KEY` env var takes precedence. |
| `model` | `claude-sonnet-4-20250514` | Claude model to use |
| `tick_interval_seconds` | `300` | Seconds between daemon ticks |
| `max_tick_duration_seconds` | `120` | Max time for a single tick |
| `system_prompt_override` | `""` | Appended to built-in system prompt |

---

## CLI Interface

`botholomew` CLI with subcommands:

| Command | Description |
|---------|-------------|
| `botholomew init` | Initialize a new `.botholomew/` project in the current directory |
| `botholomew chat` | Open the interactive chat TUI |
| `botholomew context *` | View, search, add, remove, and manage context |
| `botholomew mcpx *` | Re-export MCPX tools for operator setup |
| `botholomew task *` | View, search, add, remove, and manage tasks |
| `botholomew daemon *` | Install, manage, start/stop daemon instances |

Plus meta-utils: `--help`, `--version`

---

## Tech Stack

- **Runtime**: Bun + TypeScript
- **CLI framework**: Commander.js
- **TUI**: Ink 6 (React 19 for CLI)
- **Database**: DuckDB via `@duckdb/node-api` with VSS extension for native vector search
- **Embeddings**: `@huggingface/transformers` with `Xenova/bge-small-en-v1.5` (local, no 3rd party)
- **LLM**: `@anthropic-ai/sdk` (direct)
- **Tools**: MCPX imported as TS library
- **Styling**: `ansis` for terminal colors

---

## Milestone 1: Foundation

### Goal

Project scaffolding, data layer, CLI skeleton, and a working daemon tick loop.

### Project Structure

```
botholomew/
  docs/PLAN.md
  src/
    cli.ts                          # CLI entrypoint (commander setup)
    constants.ts                    # shared constants, defaults
    config/
      schemas.ts                    # BotholomewConfig type + defaults
      loader.ts                     # load/validate .botholomew/config.json
    db/
      connection.ts                 # DuckDB connection via @duckdb/node-api w/ retry-on-lock
      uuid.ts                       # UUIDv7 re-export from uuid package
      schema.ts                     # SQL migrations + migrate()
      tasks.ts                      # task CRUD
      schedules.ts                  # schedule CRUD (stubs)
      context.ts                    # context item CRUD (stubs)
      embeddings.ts                 # embedding CRUD (stubs)
      threads.ts                    # thread + interaction CRUD (logging)
    init/
      index.ts                      # create .botholomew/, seed, migrate
      templates.ts                  # soul.md, beliefs.md, goals.md templates
    daemon/
      index.ts                      # daemon entry: tick loop, sleep, signals
      tick.ts                       # single tick: claim task, call LLM, update status
      prompt.ts                     # system prompt builder
      llm.ts                        # Anthropic SDK wrapper + tool-use loop
    commands/
      init.ts                       # `botholomew init`
      chat.ts                       # `botholomew chat` (stub)
      context.ts                    # `botholomew context *` (stub)
      task.ts                       # `botholomew task list|add|view`
      daemon.ts                     # `botholomew daemon start|stop|status|install`
      mcpx.ts                       # `botholomew mcpx *` (stub)
    tui/
      App.tsx                       # top-level Ink component (stub)
    utils/
      frontmatter.ts                # gray-matter wrapper
      logger.ts                     # colored console logger
      pid.ts                        # PID file management
  test/
    db/
      schema.test.ts
      tasks.test.ts
      threads.test.ts
    init/
      index.test.ts
    daemon/
      tick.test.ts
  package.json
  tsconfig.json
  .gitignore
  CLAUDE.md
```

### Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.88.0",
    "uuid": "^13.0.0",
    "@evantahler/mcpx": "^0.17.0",
    "commander": "^14.0.3",
    "gray-matter": "^4.0.3",
    "ansis": "^4.2.0",
    "ink": "^6.8.0",
    "react": "^19.1.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "^19.1.0"
  }
}
```

Notes:
- DuckDB is used via `@duckdb/node-api` with the VSS extension for native vector search.
- UUIDv7 for IDs generated via the `uuid` package.
- `@xenova/transformers` for embeddings is NOT in M1 — context/embedding CRUD are stubs.
- Ink 6 requires React 19.

### DuckDB Schema

All tables in `src/db/schema.ts`. A `_migrations` table tracks applied migrations. UUIDv7 IDs are generated in application code via the `uuid` package. Enums are enforced with CHECK constraints. Array columns (blocked_by, context_ids) use JSON TEXT. Timestamps are ISO 8601 TEXT with `datetime('now')` defaults. See `src/db/sql/*.sql` for the current schema.

### Key Module Details

**`src/db/connection.ts`**
- `getConnection(dbPath)` — opens DuckDB via `@duckdb/node-api`, loads VSS extension, enables HNSW persistence
- `withRetry()` — retries on busy with exponential backoff

**`src/config/loader.ts`**
- Loads `.botholomew/config.json`, merges with defaults
- `ANTHROPIC_API_KEY` env var overrides config file value

**`src/init/index.ts`**
- Creates `.botholomew/` directory with `soul.md`, `beliefs.md`, `goals.md`, `config.json`, `mcpx/servers.json`
- Opens DuckDB and runs migrations
- Updates `.gitignore` to exclude `.botholomew/`

**`src/daemon/tick.ts`**
1. Creates a thread for this tick
2. Claims highest-priority unblocked pending task
3. Builds system prompt (loads "always" context files + meta info)
4. Runs agent loop via `llm.ts` (all interactions logged to thread)
5. Updates task status based on outcome
6. Ends thread

**`src/daemon/llm.ts`**
- Creates `Anthropic` client from config
- Defines daemon tools: `complete_task`, `fail_task`, `wait_task`, `create_task`
- Runs multi-turn tool-use loop (max 10 turns)
- Logs every interaction to the thread via `db/threads.ts`

**`src/db/threads.ts`**
- `createThread(conn, type, taskId?, title?)` -> thread ID
- `logInteraction(conn, threadId, { role, kind, content, toolName?, toolInput?, durationMs?, tokenCount? })`
- `endThread(conn, threadId)`
- `getThread(conn, threadId)` -> thread + all interactions
- `listThreads(conn, { type?, taskId?, limit? })`

**`src/utils/pid.ts`**
- PID file at `.botholomew/daemon.pid`
- `writePidFile`, `readPidFile`, `removePidFile`, `isProcessAlive`

### Implementation Sequence

#### Phase 1: Scaffolding
1. `package.json`, `tsconfig.json`, `.gitignore`
2. `bun install`
3. `src/constants.ts`, `src/utils/logger.ts`

#### Phase 2: Config + DB foundation
4. `src/config/schemas.ts` + `src/config/loader.ts`
5. `src/db/connection.ts` (retry-on-lock)
6. `src/db/schema.ts` (all migrations including threads/interactions)
7. `test/db/schema.test.ts`

#### Phase 3: DB CRUD layer
8. `src/db/tasks.ts` — full CRUD + `claimNextTask` with blocked_by logic
9. `src/db/threads.ts` — createThread, logInteraction, endThread, getThread, listThreads
10. `src/db/schedules.ts`, `src/db/context.ts`, `src/db/embeddings.ts` (stubs)
11. `test/db/tasks.test.ts`, `test/db/threads.test.ts`

#### Phase 4: Init system
12. `src/utils/frontmatter.ts`
13. `src/init/templates.ts` + `src/init/index.ts`
14. `test/init/index.test.ts`

#### Phase 5: CLI skeleton
15. `src/cli.ts` (commander entrypoint)
16. `src/commands/init.ts` (fully wired)
17. `src/commands/task.ts` (list, add, view)
18. `src/commands/daemon.ts` (start, stop, status)
19. Stub commands: chat, context, mcpx

#### Phase 6: Daemon
20. `src/utils/pid.ts`
21. `src/daemon/prompt.ts`
22. `src/daemon/llm.ts` (Anthropic SDK + tool loop + interaction logging)
23. `src/daemon/tick.ts` (orchestrator with thread lifecycle)
24. `src/daemon/index.ts` (sleep loop + signal handling)
25. `test/daemon/tick.test.ts`

#### Phase 7: Polish
26. Wire daemon start/stop into commands (detached process spawn)
27. `CLAUDE.md` with project conventions
28. `src/tui/App.tsx` minimal Ink stub
29. End-to-end test: `botholomew init && botholomew task add "test" && botholomew daemon start --foreground`

### Verification

1. **Unit tests**: `bun test` — schema migrations, task CRUD with blocked_by, thread/interaction logging
2. **Init**: `botholomew init` in a temp dir — verify `.botholomew/` structure and DB tables
3. **Task CLI**: `botholomew task add "Hello" && botholomew task list` — task appears
4. **Daemon foreground**: `botholomew daemon start --foreground` with a pending task and valid API key — claims task, calls Claude, logs interactions, updates status
5. **Thread inspection**: After daemon tick, query `threads` and `interactions` tables — full history captured
