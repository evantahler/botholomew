# Botholomew

```
 {o,o}
 /)_)
  " "
```

![Botholomew chat TUI](docs/assets/chat-happy-path.gif)

**A local-first AI agent for knowledge work.** Botholomew is a long-running
autonomous agent that works its way through a task queue — reading email,
summarizing documents, researching topics, organizing notes, and maintaining
context over time — while you sleep, work, or chat with it.

Unlike coding agents, Botholomew has **no shell, no filesystem, and no network
tools** by default. Everything it touches lives inside a single DuckDB database
at `.botholomew/data.duckdb` and a handful of markdown files. External access
is granted deliberately, per project, through MCP servers.

---

## Why Botholomew?

- **Autonomous.** A background daemon ticks on a schedule, claims tasks,
  works them with Claude, and logs every interaction. You can close the
  terminal and come back later.
- **Portable.** Each project is a `.botholomew/` directory — markdown +
  DuckDB. Copy it, share it, check it in (or `.gitignore` it).
- **Local-first.** All data stays on your machine. Embeddings are indexed in
  DuckDB's native vector store with HNSW. Model calls go direct to Anthropic
  and OpenAI.
- **Extensible.** External tools come from MCP servers via
  [MCPX](https://github.com/evantahler/mcpx) — run them locally (Gmail,
  Slack, GitHub) or connect through an MCP gateway like
  [Arcade.dev](https://www.arcade.dev/) to reach hundreds of
  authenticated services without managing each server yourself.
  Reusable workflows are defined as markdown "skills" (slash commands).
- **Safe by default.** The agent has no shell, no network, and no
  filesystem access of its own. Everything it can touch lives in
  `.botholomew/` — and every external capability is something you
  explicitly add.
- **Self-healing.** An OS-level watchdog (launchd on macOS, systemd on Linux)
  restarts the daemon if it dies, rotates logs, and runs on boot.
- **Self-modifying.** The agent maintains its own `beliefs.md` and
  `goals.md` — it learns, updates its priors, and revises its goals as it
  works.

---

## Install

Requires [Bun](https://bun.sh) 1.1+.

```bash
bun install -g botholomew
```

Or run the dev build from a checkout:

```bash
git clone https://github.com/evantahler/botholomew
cd botholomew
bun install
bun run dev -- --help
```

---

## Quickstart

```bash
# 1. Initialize a project in the current directory
botholomew init

# 2. Add your API keys to .botholomew/config.json, or export env vars
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...     # used for embeddings

# 3. Queue some work
botholomew task add "Summarize every markdown file in ~/notes"

# 4. Start the daemon (foreground — watch it work)
botholomew daemon start --foreground

# 5. Or chat with the agent interactively
botholomew chat
```

---

## What a project looks like

```
my-project/
  .botholomew/
    soul.md               # always-loaded identity (not agent-editable)
    beliefs.md            # always-loaded, agent-editable priors
    goals.md              # always-loaded, agent-editable goals
    config.json           # models, tick interval, API keys
    data.duckdb           # tasks, schedules, context, embeddings, logs
    mcpx/servers.json     # external MCP servers (Gmail, Slack, …)
    skills/               # user-defined slash commands
      summarize.md
      standup.md
    daemon.pid            # PID file for the running daemon
    daemon.log            # rotating daemon logs
```

Everything the agent can touch is here. No surprises.

---

## The CLI

| Command | Purpose |
|---|---|
| `botholomew init` | Create `.botholomew/` with templates and a fresh database |
| `botholomew daemon start\|stop\|status` | Run, stop, or inspect the daemon |
| `botholomew daemon install\|uninstall` | Register/remove the OS watchdog |
| `botholomew daemon list` | List all Botholomew projects on this machine |
| `botholomew chat` | Interactive Ink/React TUI |
| `botholomew task list\|add\|view\|update\|reset\|delete` | Manage the task queue |
| `botholomew schedule list\|add\|enable\|trigger\|delete` | Recurring work |
| `botholomew context add\|list\|view\|search\|refresh\|remove` | Ingest & browse knowledge (files, folders, URLs) |
| `botholomew mcpx servers\|add\|remove\|info\|search\|exec\|ping\|auth\|import-global` | Configure external MCP servers |
| `botholomew skill list\|show\|create\|validate` | Manage slash-command skills |
| `botholomew context ... \| search ...` | Direct access to the agent's virtual filesystem |
| `botholomew thread list\|view` | Browse the agent's interaction history |
| `botholomew nuke context\|tasks\|schedules\|threads\|all` | Bulk-erase sections of the database |
| `botholomew upgrade` | Self-update |

All `list` subcommands support `-l, --limit <n>` and `-o, --offset <n>` for pagination.

---

## How it works

```
 ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
 │    Chat      │         │   Daemon     │         │  Watchdog    │
 │   (Ink TUI)  │         │  (tick loop) │         │ launchd/     │
 │              │         │              │         │ systemd      │
 └──────┬───────┘         └──────┬───────┘         └──────┬───────┘
        │                        │                        │
        │ enqueue tasks          │ claims tasks           │ every 60s:
        │ browse history         │ runs LLM tool loops    │ check PID
        │ invoke skills          │ updates status         │ restart if
        │                        │ logs to threads        │ dead
        │                        │                        │
        └────────────┬───────────┴────────────┬───────────┘
                     │                        │
               ┌─────▼────────────────────────▼─────┐
               │        DuckDB                       │
               │  ┌───────────┐ ┌──────────────┐    │
               │  │  tasks    │ │ context_items│    │
               │  │ schedules │ │  embeddings  │    │
               │  │  threads  │ │   (HNSW)     │    │
               │  └───────────┘ └──────────────┘    │
               └─────┬───────────────────────────────┘
                     │
                     ▼
              MCPX ─► Gmail, Slack, GitHub, Firecrawl, …
```

See [docs/architecture.md](docs/architecture.md) for a deeper tour.

---

## Deep dives

Topics worth understanding in detail:

- **[Architecture](docs/architecture.md)** — daemon, chat, watchdog, and how
  they share a database.
- **[The TUI](docs/tui.md)** — the `botholomew chat` Ink/React terminal UI:
  seven tabs, slash-command autocomplete, message queue, and tool-call
  visualization.
- **[The virtual filesystem](docs/virtual-filesystem.md)** — why the agent's
  "files" are actually DuckDB rows, and how `context_read`/`context_write` work.
- **[Context & hybrid search](docs/context-and-search.md)** — LLM-driven
  chunking, OpenAI embeddings, and DuckDB's HNSW-accelerated keyword +
  vector search.
- **[Tasks & schedules](docs/tasks-and-schedules.md)** — the claim loop, DAG
  validation, stale-task recovery, and natural-language recurring schedules.
- **[The Tool class](docs/tools.md)** — one Zod definition, three consumers
  (Anthropic tool-use, Commander CLI, tests).
- **[Persistent context](docs/persistent-context.md)** — `soul.md`,
  `beliefs.md`, `goals.md`, frontmatter flags, and agent self-modification.
- **[Skills (slash commands)](docs/skills.md)** — reusable prompt templates
  with positional arguments and tab completion.
- **[MCPX integration](docs/mcpx.md)** — configuring external servers and
  how MCP tools are merged into the agent's toolset.
- **[The watchdog](docs/watchdog.md)** — launchd plists, systemd units, and
  multi-project service naming.
- **[Configuration](docs/configuration.md)** — every key in `config.json`
  and its default.
- **[Doc captures](docs/captures.md)** — how the screenshots and GIFs in
  these docs are regenerated programmatically via VHS and a fake-LLM mode.

---

## Tech stack

- **[Bun](https://bun.sh)** + TypeScript
- **[DuckDB](https://duckdb.org)** via `@duckdb/node-api`, with the
  **[VSS extension](https://duckdb.org/docs/stable/extensions/vss)** for
  native vector search
- **[Anthropic SDK](https://docs.anthropic.com/en/api/client-sdks)** for
  Claude — the reasoning model
- **OpenAI embeddings API** (`text-embedding-3-small`, 1536-dim) for
  semantic search
- **[MCPX](https://github.com/evantahler/mcpx)** for external tools
- **[Ink 6](https://github.com/vadimdemedes/ink)** + **React 19** for the
  terminal UI
- **[Commander.js](https://github.com/tj/commander.js)** for the CLI
- **[Zod](https://zod.dev)** for tool input/output schemas

---

## Contributing

```bash
bun install
bun test
bun run lint            # tsc --noEmit + biome check
```

See [CLAUDE.md](CLAUDE.md) for conventions (always use `bun`, bump the
version in `package.json` on every merge to `main`, etc.).

---

## License

MIT.
