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

Botholomew has **no shell and no access to your real filesystem**. The
agent's world is a sandboxed `context/` tree inside the project: it can
read, write, edit, and grep files there, but cannot escape upward,
follow symlinks, or touch anything outside. Local files and URLs are
brought in through `botholomew context add`. External capabilities
(email, Slack, the web, and hundreds of other services) are granted
deliberately, per project, through MCP servers wired up via
[MCPX](https://github.com/evantahler/mcpx).

---

## Why Botholomew?

- **Autonomous.** Background **workers** claim tasks, work them with Claude,
  and log every interaction. You can spawn one-shot workers on demand, a
  long-running `--persist` worker, or point cron at `botholomew worker run`.
- **Portable.** A project is just a directory of files — markdown for
  prompts, tasks, schedules, and context; CSVs for conversation history.
  Copy it, share it, `git diff` it, check it in (or `.gitignore` it).
- **Your data, your disk.** Tasks, schedules, threads, and the agent's
  context tree are all real files you can `vim`, `grep`, and `git`.
  DuckDB is demoted to a single search-index sidecar (`index.duckdb`)
  that's fully derivable from disk and safe to delete. Model calls go
  direct to Anthropic; any further reach is scoped to the MCP servers
  you add.
- **Extensible.** External tools come from MCP servers via
  [MCPX](https://github.com/evantahler/mcpx) — run them locally (Gmail,
  Slack, GitHub) or connect through an MCP gateway like
  [Arcade.dev](https://www.arcade.dev/) to reach hundreds of
  authenticated services without managing each server yourself.
  Reusable workflows are defined as markdown "skills" (slash commands)
  that the chat agent can also create, edit, and search at runtime.
- **Safe by default.** The agent has no shell and no direct filesystem
  access. Every path-taking tool is sandboxed to the project's `context/`
  tree (NFC normalization + lstat-walk to reject symlinks at any level);
  every external capability is an MCP server you explicitly add.
- **Concurrent.** Many workers can run at once. Each writes a pidfile
  and heartbeats; tasks and schedules are claimed via `O_EXCL` lockfiles
  and crashed workers get reaped automatically.
- **Self-modifying.** The agent maintains its own `beliefs.md` and
  `goals.md` — it learns, updates its priors, and revises its goals as it
  works. It can also author its own slash-command skills mid-conversation,
  turning prompts you keep retyping into durable project assets.

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

The CLI installs as both `botholomew` and `bothy` — the same binary, two names.

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

# 2. Add your Anthropic key to config/config.json, or export it
export ANTHROPIC_API_KEY=sk-ant-...
# Embeddings run locally — no API key required.

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

A project is the directory you ran `botholomew init` in. Every entity
the agent or worker touches is a real file you can `vim`, `grep`, and
`git diff`:

```
my-project/
  config/config.json                # models, tick interval, API keys
  prompts/                          # markdown files loaded into every system prompt (or keyword-loaded)
    goals.md                        #   identity + current goals (agent-editable)
    beliefs.md                      #   agent-editable priors
    capabilities.md                 #   auto-generated tool inventory
  skills/                           # slash commands (built-ins + user-defined)
    summarize.md
    standup.md
    capabilities.md
  mcpx/servers.json                 # external MCP servers (Gmail, Slack, …)
  models/                           # local embedding model cache
  context/                          # agent-writable knowledge tree
  tasks/                            # one markdown file per task
    <id>.md                         #   status & metadata in frontmatter
    .locks/<id>.lock                #   O_EXCL claim file (held by a worker)
  schedules/                        # one markdown file per schedule
    <id>.md
    .locks/<id>.lock
  threads/<YYYY-MM-DD>/<id>.csv     # full conversation history
  workers/<id>.json                 # worker pidfile + heartbeat
  logs/<YYYY-MM-DD>/<id>.log        # per-worker logs
  index.duckdb                      # search index sidecar (rebuildable; safe to delete)
```

`index.duckdb` is the only opaque file; everything else is plain text.
Delete the index any time and `botholomew context reindex` rebuilds it
from `context/`.

---

## The CLI

![CLI walkthrough: task list, task add, schedule list, context list](docs/assets/cli-tour.gif)

| Command | Purpose |
|---|---|
| `botholomew init` | Initialize the current directory as a project (refuses on iCloud/Dropbox/NFS without `--force`) |
| `botholomew worker run\|start` | Run a worker (foreground or background); `--persist` for long-running, `--task-id <id>` to target one task |
| `botholomew worker list\|status\|stop\|kill\|reap` | Inspect and manage running workers |
| `botholomew chat` | Interactive Ink/React TUI |
| `botholomew task list\|add\|view\|update\|reset\|delete` | Manage the task queue (markdown files in `tasks/`) |
| `botholomew schedule list\|add\|view\|enable\|disable\|trigger\|delete` | Recurring work (markdown files in `schedules/`) |
| `botholomew context add\|import\|tree\|stats\|reindex\|search\|read\|write\|edit\|move\|delete\|…` | Bring files/URLs into `context/`; rebuild the search index; expose the agent's file/dir tools as CLI subcommands |
| `botholomew capabilities` | Rescan built-in + MCPX tools and rewrite `prompts/capabilities.md` |
| `botholomew prompts list\|show\|create\|edit\|delete\|validate` | CRUD over the markdown files in `prompts/` (with strict frontmatter validation) |
| `botholomew mcpx servers\|list\|add\|remove\|info\|search\|exec\|ping\|auth\|deauth\|import-global\|…` | Configure external MCP servers (passthrough to `mcpx`) |
| `botholomew skill list\|show\|create\|validate` | Manage slash-command skills |
| `botholomew thread list\|view` | Browse the agent's conversation history (CSVs in `threads/`) |
| `botholomew nuke context\|tasks\|schedules\|threads\|all` | Bulk-erase project state |
| `botholomew db doctor [--repair]` | Probe the search-index DB; rebuild via EXPORT/IMPORT |
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
        │ enqueue tasks          │ pidfile + heartbeat    │ fire
        │ browse history         │ claim via O_EXCL lock  │ `worker run`
        │ spawn_worker tool      │ run LLM tool loops     │ on a
        │ invoke skills          │ reap orphan locks      │ schedule
        │                        │ log threads → CSV      │
        └────────────┬───────────┴────────────┬───────────┘
                     │                        │
              ┌──────▼────────────────────────▼──────┐
              │     <project-root>/                   │
              │       tasks/<id>.md                   │
              │       schedules/<id>.md               │
              │       threads/<date>/<id>.csv         │
              │       workers/<id>.json               │
              │       context/  ─►  index.duckdb      │
              │                     (search sidecar)  │
              └──────────────────┬────────────────────┘
                                 │
                                 ▼
                  MCPX ─► Gmail, Slack, GitHub, Firecrawl, …
```

See [docs/architecture.md](docs/architecture.md) for a deeper tour.

---

## Deep dives

> The full docs site is published at **[www.botholomew.com](https://www.botholomew.com)**.

Topics worth understanding in detail:

- **[Architecture](docs/architecture.md)** — workers, chat, and how
  they share a database. Registration, heartbeat, and reaping.
- **[Automation](docs/automation.md)** — cron recipes and optional
  launchd/systemd samples for running workers on a schedule without a
  shipped watchdog.
- **[The TUI](docs/tui.md)** — the `botholomew chat` Ink/React terminal UI:
  eight tabs, slash-command autocomplete, message queue, tool-call
  visualization, and a live workers panel.
- **[Files & the sandbox](docs/files.md)** — the agent's `context/`
  tree, the path sandbox (NFC + lstat-walk), and how
  `context_read`/`context_write`/`context_edit` work.
- **[Context & hybrid search](docs/context-and-search.md)** — LLM-driven
  chunking, local embeddings, and DuckDB BM25 + linear-scan vector
  search merged with reciprocal rank fusion.
- **[Tasks & schedules](docs/tasks-and-schedules.md)** — markdown
  frontmatter as the source of truth, lockfile-based claim, DAG
  validation, and natural-language recurring schedules.
- **[The Tool class](docs/tools.md)** — one Zod definition, three consumers
  (Anthropic tool-use, Commander CLI, tests).
- **[Prompts](docs/prompts.md)** — generic markdown files in `prompts/`,
  strict frontmatter validation, and full CRUD via CLI + agent tools.
- **[Skills (slash commands)](docs/skills.md)** — reusable prompt templates
  with positional arguments and tab completion; the chat agent can also
  create, edit, and search them at runtime.
- **[MCPX integration](docs/mcpx.md)** — configuring external servers and
  how MCP tools are merged into the agent's toolset.
- **[Configuration](docs/configuration.md)** — every key in `config.json`
  and its default.
- **[Doc captures](docs/captures.md)** — how the screenshots and GIFs in
  these docs are regenerated programmatically via VHS and a fake-LLM mode.

---

## Tech stack

- **[Bun](https://bun.sh)** + TypeScript
- **[DuckDB](https://duckdb.org)** via `@duckdb/node-api` — drives the
  search-index sidecar only. `array_cosine_distance()` (core DuckDB) for
  vector search, plus the built-in FTS extension for BM25 keyword
  search; the index is rebuildable from `context/` at any time
- **[Anthropic SDK](https://docs.anthropic.com/en/api/client-sdks)** for
  Claude — the reasoning model
- **[`@huggingface/transformers`](https://huggingface.co/docs/transformers.js)**
  for local embeddings (default `Xenova/bge-small-en-v1.5`, 384-dim) —
  no API key, weights cached on first run
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
