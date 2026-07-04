# Botholomew

```
 {o,o}
 /)_)
  " "
```

![Botholomew chat TUI](docs/assets/chat-happy-path.gif)

**An AI agent for knowledge work.** Point Botholomew at your docs,
projects, and inboxes and it reads them, remembers them, and works a
durable task queue — summarizing, researching, organizing, chasing
things down — while you sleep, work, or chat with it. It runs locally
(local LLMs included), and it's built around a large memory store rather
than a single chat window.

Botholomew has **no shell and no access to your real filesystem**. The
agent's world is a per-project knowledge store managed by
[`membot`](https://github.com/evantahler/membot) — every read, write,
search, and delete is addressed by `logical_path` (a DB key, not a
filesystem path), so a prompt-injected attempt to reach `~/.ssh/id_rsa`
has nowhere to land. Local files and URLs are brought in through
`botholomew membot add`. External capabilities (email, Slack, the web,
and hundreds of other services) are granted deliberately, per project,
through MCP servers wired up via
[MCPX](https://github.com/evantahler/mcpx).

---

## Why I built this

I built the agent I wanted for my own manager-style work — the reading,
summarizing, chasing-down, and _remembering_ that fills a week. Nothing
on the shelf fit, so Botholomew is opinionated on purpose:

- **Memory is the point, not a feature.** I load it up with every Linear
  project and hundreds of Google Docs and expect it to search across all
  of them. The knowledge store isn't bolted on — the whole agent is built
  around it.
- **Local, including local LLMs.** It runs on my machine and talks to
  Ollama just as happily as it talks to Anthropic.
- **Real tasks, not a swarm.** Durable, schedulable, monitorable tasks
  with DAGs — not fire-and-forget subagents. (My distributed-systems
  background wouldn't let me ship anything less.)
- **Hyper-focused on tool use.** Its reach into the outside world runs
  through an [Arcade](https://www.arcade.dev/) gateway — one
  authenticated door to hundreds of services, which is where most of the
  interesting work actually happens.

It's also nerdy by design: every prompt, task, thread, and belief is a
plain file I can open, `grep`, and `git diff`. — Evan

---

## Why Botholomew?

- **Memory-first.** The agent is built to reason over a large corpus, not
  a single chat. Ingest hundreds of files and URLs (PDF/DOCX/HTML →
  markdown) into a local [`membot`](https://github.com/evantahler/membot)
  store with hybrid BM25 + semantic search, append-only versioning, and
  history you can `diff`. Big tool responses get piped into the same store
  so the agent can work through megabytes of JSON without burning tokens.
- **Autonomous.** Background **workers** claim tasks, work them with Claude,
  and log every interaction. You can spawn one-shot workers on demand, a
  long-running `--persist` worker, or point cron at `botholomew worker run`.
- **Portable.** A project is just a directory of files — markdown for
  prompts, tasks, schedules, and context; CSVs for conversation history.
  Copy it, share it, `git diff` it, check it in (or `.gitignore` it).
- **Your data, your disk.** Tasks, schedules, threads, prompts, and
  skills are all real files you can `vim`, `grep`, and `git`. The
  knowledge store is a single local DuckDB file (`index.duckdb`,
  managed by [`membot`](https://github.com/evantahler/membot)) — append-only,
  versioned, queryable with the DuckDB CLI if you ever want to. Model
  calls go direct to Anthropic; any further reach is scoped to the MCP
  servers you add.
- **Tool use, done through a gateway.** External tools come from MCP
  servers via [MCPX](https://github.com/evantahler/mcpx). Run them locally
  (Gmail, Slack, GitHub) — but the setup Botholomew is tuned for points a
  single [Arcade](https://www.arcade.dev/) gateway at hundreds of
  authenticated services, so you handle auth once instead of babysitting a
  server per tool. Reusable workflows are markdown "skills" (slash
  commands) the chat agent can also create, edit, and search at runtime.
- **Safe by default.** The agent has no shell and no direct filesystem
  access. The knowledge store is keyed by `logical_path` (an opaque DB
  string, not a filesystem path); every external capability is an MCP
  server you explicitly add. The remaining file-system paths the agent
  touches (`tasks/`, `schedules/`, `prompts/`, `skills/`) all route
  through a single sandbox helper (NFC normalization + lstat-walk to
  reject symlinks at any level).
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

**Prebuilt binary** (no Bun required — one self-contained file per platform):

```bash
curl -fsSL https://raw.githubusercontent.com/evantahler/botholomew/main/install.sh | sh
```

macOS (arm64) and Linux (x64); on Windows grab `botholomew-windows-x64.exe`
from the [releases](https://github.com/evantahler/botholomew/releases/latest). Then
`botholomew upgrade` updates it in place.

**With Bun** (requires [Bun](https://bun.sh) 1.1+):

```bash
bun install -g botholomew
```

Either way the CLI installs as both `botholomew` and `bothy` — the same binary, two names.

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

# 2a. Add your Anthropic key (Claude is the default) to config/config.json, or export it
export ANTHROPIC_API_KEY=sk-ant-...
# Embeddings always run locally.
#
# 2b. ...or initialize for a local Ollama model — no API key required:
#     ollama serve & ollama pull llama3.1:8b
#     botholomew init --force --provider ollama
# See docs/configuration.md for OpenAI-compatible endpoints (LM Studio, OpenRouter, etc.).

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

## Example configs

Two `config/config.json` shapes covering the common cases. Full schema in
[docs/configuration.md](docs/configuration.md).

### Anthropic (Claude — default)

```jsonc
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "api_key": "sk-ant-..."
  },
  "chunker_llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "api_key": "sk-ant-..."
  }
}
```

Or leave `api_key` blank and export `ANTHROPIC_API_KEY` in your shell.

### Ollama (fully local)

```jsonc
{
  "llm": {
    "provider": "ollama",
    "model": "qwen2.5:7b",
    "base_url": "http://localhost:11434"
  },
  "chunker_llm": {
    "provider": "ollama",
    "model": "qwen2.5:7b",
    "base_url": "http://localhost:11434"
  }
}
```

Start Ollama first: `ollama serve &` then `ollama pull qwen2.5:7b`. No
API key required. Tool calling is a hard requirement — known-good local
models include `qwen2.5:7b`, `llama3.1:8b`, `mistral-nemo`, and
`command-r`. For OpenAI-compatible endpoints (LM Studio, OpenRouter,
vLLM, …) see [docs/configuration.md](docs/configuration.md).

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
  index.duckdb                      # knowledge store (managed by membot)
  config.json                       # membot config (separate from config/config.json)
  tasks/                            # one markdown file per task
    <id>.md                         #   status & metadata in frontmatter
    .locks/<id>.lock                #   O_EXCL claim file (held by a worker)
  schedules/                        # one markdown file per schedule
    <id>.md
    .locks/<id>.lock
  threads/<YYYY-MM-DD>/<id>.csv     # full conversation history
  workers/<id>.json                 # worker pidfile + heartbeat
  logs/<YYYY-MM-DD>/<id>.log        # per-worker logs
```

Tasks, schedules, threads, prompts, and skills are plain text — `vim`,
`grep`, and `git` work without ceremony. The agent's knowledge store
lives in `index.duckdb`, managed end-to-end by the
[`membot`](https://github.com/evantahler/membot) library: ingestion
(PDF/DOCX/HTML → markdown), local WASM embeddings, hybrid BM25 +
semantic search, append-only versioning, and URL refresh all live there.

---

## The CLI

![CLI walkthrough: task list, task add, schedule list, context list](docs/assets/cli-tour.gif)

| Command | Purpose |
|---|---|
| `botholomew init` | Initialize the current directory as a project (refuses on iCloud/Dropbox/NFS without `--force`) |
| `botholomew status` | One-command dashboard: workers, task counts/claims, schedules (with a live "due?" check), quarantined files, store info. `--json` for scripting, `--no-evaluate` to skip the LLM schedule check |
| `botholomew worker run\|start` | Run a worker (foreground or background); `--persist` for long-running, `--task-id <id>` to target one task, `--unsafe` to bypass the tool-approval gate |
| `botholomew worker list\|status\|stop\|kill\|reap` | Inspect and manage running workers |
| `botholomew chat` | Interactive Ink/React TUI (`--unsafe` to bypass the tool-approval gate) |
| `botholomew dream` | Reflect on recent threads — consolidate learnings into the knowledge store and update beliefs/goals (`--since`, `--dry-run`); also `/dream` in chat |
| `botholomew task list\|add\|view\|update\|reset\|delete` | Manage the task queue (markdown files in `tasks/`) |
| `botholomew schedule list\|add\|view\|enable\|disable\|trigger\|delete` | Recurring work (markdown files in `schedules/`) |
| `botholomew approval list\|view\|approve\|deny` | Review and decide pending outbound-tool approvals (markdown files in `approvals/`) |
| `botholomew notify <message>` | Send a notification through the configured channels (desktop / Slack / email); `--title`, `--severity`, `--channel` |
| `botholomew membot add\|ls\|tree\|read\|write\|search\|info\|versions\|diff\|refresh\|…` | Knowledge-store passthrough to [`membot`](https://github.com/evantahler/membot) — `--config` is resolved from `membot_scope` (default `~/.membot`) |
| `botholomew membot import-global` | Seed the project from `~/.membot` (copies `index.duckdb` + `config.json` in) |
| `botholomew capabilities` | Rescan built-in + MCPX tools and rewrite `prompts/capabilities.md` |
| `botholomew prompts list\|show\|create\|edit\|delete\|validate` | CRUD over the markdown files in `prompts/` (with strict frontmatter validation) |
| `botholomew mcpx servers\|list\|add\|remove\|info\|search\|exec\|ping\|auth\|deauth\|import-global\|…` | Configure external MCP servers (passthrough to `mcpx`) |
| `botholomew skill list\|show\|create\|validate` | Manage slash-command skills |
| `botholomew thread list\|view\|search\|delete\|follow` | Browse and search the agent's conversation history (CSVs in `threads/`) |
| `botholomew nuke knowledge\|tasks\|schedules\|threads\|all` | Bulk-erase project state |
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
              │       prompts/, skills/, mcpx/        │
              │       index.duckdb  ◄─ membot         │
              │       (knowledge store)               │
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
- **[Files & the knowledge store](docs/files.md)** — the membot store,
  the path sandbox (NFC + lstat-walk) for non-knowledge files, and how
  `membot_read`/`membot_write`/`membot_edit` work.
- **[Context & search](docs/context-and-search.md)** — pointer to
  membot for ingestion, chunking, embeddings, and hybrid search.
- **[Tasks & schedules](docs/tasks-and-schedules.md)** — markdown
  frontmatter as the source of truth, lockfile-based claim, DAG
  validation, and natural-language recurring schedules.
- **[The Tool class](docs/tools.md)** — one Zod definition, three consumers
  (Anthropic tool-use, Commander CLI, tests).
- **[Prompts](docs/prompts.md)** — generic markdown files in `prompts/`,
  strict frontmatter validation, and full CRUD via CLI + agent tools.
- **[Reflection (dream)](docs/reflection.md)** — `botholomew dream` / `/dream`:
  consolidating recent threads into durable memory and self-edited prompts,
  plus episodic `thread search`.
- **[Skills (slash commands)](docs/skills.md)** — reusable prompt templates
  with positional arguments and tab completion; the chat agent can also
  create, edit, and search them at runtime.
- **[MCPX integration](docs/mcpx.md)** — configuring external servers and
  how MCP tools are merged into the agent's toolset.
- **[Approvals](docs/approvals.md)** — the human-in-the-loop gate on outbound
  mcpx tool calls: default deny, the allowlist, the worker approval queue,
  and `--unsafe`.
- **[Notifications](docs/notifications.md)** — how workers reach you: desktop
  popups, Slack/email via mcpx, worker auto-hooks on task failure, and the
  `notify` agent tool.
- **[Configuration](docs/configuration.md)** — every key in `config.json`
  and its default.
- **[Doc captures](docs/captures.md)** — how the screenshots and GIFs in
  these docs are regenerated programmatically via VHS and a fake-LLM mode.
- **[Field notes](docs/field-notes.md)** — what I learned building this:
  why tools are named after bash, why big tool responses go into memory,
  and the one agent trend I think is overrated.

---

## Tech stack

- **[Bun](https://bun.sh)** + TypeScript
- **[`membot`](https://github.com/evantahler/membot)** — owns the
  knowledge store: ingestion (PDF/DOCX/HTML → markdown), local WASM
  embeddings, hybrid BM25 + semantic search over DuckDB, append-only
  versioning, URL refresh. Botholomew consumes it as an SDK.
- **[Anthropic SDK](https://docs.anthropic.com/en/api/client-sdks)** for
  Claude — the reasoning model
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
