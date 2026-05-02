# Get started

This page walks you from a clean machine to a running Botholomew worker
processing tasks. For deeper background, see
[Architecture](./architecture.md).

## Prerequisites

- **[Bun](https://bun.sh) 1.1+** — Botholomew is a Bun-native CLI.
- **An Anthropic API key** — Claude is the reasoning model.
- **An OpenAI API key** — used for embeddings (`text-embedding-3-small`).
- Optional: any [MCP servers](./mcpx.md) you want to expose to the agent
  (Gmail, Slack, GitHub, etc.) — managed through
  [MCPX](https://github.com/evantahler/mcpx).

## Install

```bash
bun install -g botholomew
```

Or run from a checkout:

```bash
git clone https://github.com/evantahler/botholomew
cd botholomew
bun install
bun run dev -- --help
```

## Initialize a project

In any directory you want Botholomew to operate inside:

```bash
botholomew init
```

This creates a `.botholomew/` directory with templates and a fresh
DuckDB database:

```
my-project/
  .botholomew/
    soul.md               # always-loaded identity (not agent-editable)
    beliefs.md            # always-loaded, agent-editable priors
    goals.md              # always-loaded, agent-editable goals
    capabilities.md       # always-loaded, agent-editable tool inventory
    config.json           # models, tick interval, API keys
    data.duckdb           # tasks, schedules, context, embeddings, logs
    mcpx/servers.json     # external MCP servers (Gmail, Slack, …)
    skills/               # slash commands (built-ins + user-defined)
    logs/                 # per-worker log files
```

Everything the agent can touch is here — see
[The virtual filesystem](./virtual-filesystem.md) for why.

## Configure API keys

Either export environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

…or set them in `.botholomew/config.json`. See
[Configuration](./configuration.md) for every key and its default.

## Queue work and run a worker

```bash
# Add a task to the queue
botholomew task add "Summarize every markdown file in ~/notes"

# Process it
botholomew worker run                  # one-shot: claim and run one task
botholomew worker run --persist        # long-running: loop until you stop it
```

Want it to run on its own? See [Automation](./automation.md) for cron,
tmux, launchd, and systemd recipes.

## Chat interactively

```bash
botholomew chat
```

The chat command opens an [Ink/React TUI](./tui.md) with eight tabs —
chat, tasks, workers, context, schedules, threads, history, and logs —
plus slash-command autocomplete, a message queue, tool-call
visualization, and a live workers panel.

## What's next

- [The CLI reference](https://github.com/evantahler/botholomew#the-cli)
  on GitHub
- [Architecture](./architecture.md) — workers, chat, shared DB
- [Tasks & schedules](./tasks-and-schedules.md) — the claim loop and
  recurring schedules
- [Context & hybrid search](./context-and-search.md) — ingest files,
  folders, and URLs
- [MCPX integration](./mcpx.md) — wire up external services
- [Skills](./skills.md) — slash-command templates the agent can also
  author at runtime
