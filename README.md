# Botholomew

```
 {o,o}
 /)_)
  " "
```

![Botholomew chat TUI](docs/assets/chat-happy-path.gif)

**An AI agent for knowledge work.** Botholomew is an autonomous agent
that works its way through a task queue — reading email, summarizing
documents, researching topics, organizing notes, and maintaining context
over time — while you sleep, work, or chat with it.

Unlike coding agents, Botholomew has **no shell and no direct access to
your filesystem**. It can't edit files on disk — instead, it ingests local
files, folders, and URLs into a DuckDB-backed context store that it can
read, search, and summarize. External capabilities (email, Slack, the web,
and hundreds of other services) are granted deliberately, per project,
through MCP servers wired up via [MCPX](https://github.com/evantahler/mcpx).

---

## Why Botholomew?

- **Autonomous.** Background **workers** claim tasks, work them with Claude,
  and log every interaction. You can spawn one-shot workers on demand, a
  long-running `--persist` worker, or point cron at `botholomew worker run`.
- **Portable.** Each project is a `.botholomew/` directory — markdown +
  DuckDB. Copy it, share it, check it in (or `.gitignore` it).
- **Your data, your disk.** Project state — tasks, threads, ingested
  context, embeddings — lives in `.botholomew/`, indexed in DuckDB with
  HNSW for vector search. Model calls go direct to Anthropic and OpenAI;
  any further reach is scoped to the MCP servers you add.
- **Extensible.** External tools come from MCP servers via
  [MCPX](https://github.com/evantahler/mcpx) — run them locally (Gmail,
  Slack, GitHub) or connect through an MCP gateway like
  [Arcade.dev](https://www.arcade.dev/) to reach hundreds of
  authenticated services without managing each server yourself.
  Reusable workflows are defined as markdown "skills" (slash commands).
- **Safe by default.** The agent has no shell and no direct filesystem
  access. Out of the box, everything it can touch lives in `.botholomew/`;
  every external capability is a MCP server you explicitly add.
- **Concurrent.** Many workers can run at once. Each registers itself in
  the DB and heartbeats; crashed workers get reaped and their tasks go
  back into the queue automatically.
- **Self-modifying.** The agent maintains its own `beliefs.md` and
  `goals.md` — it learns, updates its priors, and revises its goals as it
  works.

---

## Demo

A full tour of the chat TUI — every tab, slash-command autocomplete,
the message queue, tool-call visualization, and the live workers panel:

![Tour of every tab in the chat TUI](docs/assets/full-tour.gif)

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

# 4. Run a worker to process the queue
botholomew worker run                  # one-shot: claim and run one task
botholomew worker run --persist        # long-running: loop until you stop it

# 5. Or chat with the agent interactively
botholomew chat
```

See [docs/automation.md](docs/automation.md) for cron-based setups if you
want Botholomew to advance on its own.

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
    worker.log            # stdout/stderr from spawned workers
```

Everything the agent can touch is here. No surprises.

---

## The CLI

![CLI walkthrough: task list, task add, schedule list, context list](docs/assets/cli-tour.gif)

| Command | Purpose |
|---|---|
| `botholomew init` | Create `.botholomew/` with templates and a fresh database |
| `botholomew worker run\|start` | Run a worker (foreground or background); `--persist` for long-running, `--task-id <id>` to target one task |
| `botholomew worker list\|status\|stop\|kill\|reap` | Inspect and manage running workers |
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
 │    Chat      │         │  Worker(s)   │         │    cron /    │
 │   (Ink TUI)  │         │  (tick loop) │         │    tmux      │
 │              │         │              │         │    (optional)│
 └──────┬───────┘         └──────┬───────┘         └──────┬───────┘
        │                        │                        │
        │ enqueue tasks          │ register + heartbeat   │ fire
        │ browse history         │ claim tasks            │ `worker run`
        │ spawn_worker tool      │ run LLM tool loops     │ on a
        │ invoke skills          │ reap dead peers        │ schedule
        │                        │ log to threads         │
        └────────────┬───────────┴────────────┬───────────┘
                     │                        │
               ┌─────▼────────────────────────▼─────┐
               │        DuckDB                       │
               │  ┌───────────┐ ┌──────────────┐    │
               │  │  tasks    │ │ context_items│    │
               │  │ schedules │ │  embeddings  │    │
               │  │  workers  │ │   (HNSW)     │    │
               │  │  threads  │ │              │    │
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

- **[Architecture](docs/architecture.md)** — workers, chat, and how
  they share a database. Registration, heartbeat, and reaping.
- **[Automation](docs/automation.md)** — cron recipes and optional
  launchd/systemd samples for running workers on a schedule without a
  shipped watchdog.
- **[The TUI](docs/tui.md)** — the `botholomew chat` Ink/React terminal UI:
  eight tabs, slash-command autocomplete, message queue, tool-call
  visualization, and a live workers panel.
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
