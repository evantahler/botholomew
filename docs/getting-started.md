# Get started

This page walks you from a clean machine to a running Botholomew worker
processing tasks. For deeper background, see
[Architecture](./architecture.md).

## Prerequisites

- **[Bun](https://bun.sh) 1.1+** — Botholomew is a Bun-native CLI.
- **An Anthropic API key** — Claude is the reasoning model.
- Embeddings run locally via `@huggingface/transformers` (default
  `Xenova/bge-small-en-v1.5`, 384-dim). The first call downloads ~33 MB
  of weights into the project's `models/` directory; no API key is
  required.
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

This creates a project tree in the current directory — every entity
the agent or worker touches is a real file you can `vim`, `grep`, and
`git diff`:

```
my-project/
  config/config.json                # models, tick interval, API keys
  prompts/                          # always-loaded markdown
    soul.md                         #   identity (not agent-editable)
    beliefs.md                      #   agent-editable priors
    goals.md                        #   agent-editable goals
    capabilities.md                 #   agent-editable tool inventory
  skills/                           # slash commands (built-ins + user-defined)
  mcpx/servers.json                 # external MCP servers (Gmail, Slack, …)
  models/                           # local embedding model cache
  context/                          # agent-writable knowledge tree
  tasks/<id>.md                     # tasks (status in frontmatter)
  schedules/<id>.md                 # schedules
  threads/<YYYY-MM-DD>/<id>.csv     # conversation history
  workers/<id>.json                 # worker pidfile + heartbeat
  logs/<YYYY-MM-DD>/<id>.log        # per-worker logs
  index.duckdb                      # search-index sidecar (rebuildable)
```

The agent can only touch files under `context/`, and only through a
sandbox that rejects symlinks and traversal — see
[Files & the sandbox](./files.md) for why.

> `init` refuses to run on iCloud/Dropbox/OneDrive/NFS volumes (they
> break the atomic-rename and `O_EXCL` guarantees that
> tasks/schedules depend on). Pass `--force` to override.

## Configure API keys

Either export the environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

…or set it in `config/config.json`. See
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
Chat, Tools, Context, Tasks, Threads, Schedules, Workers, and Help —
plus slash-command autocomplete, a message queue, tool-call
visualization, and a live workers panel.

## What's next

- [The CLI reference](https://github.com/evantahler/botholomew#the-cli)
  on GitHub
- [Architecture](./architecture.md) — workers, chat, shared project
  directory on disk, search-index sidecar
- [Tasks & schedules](./tasks-and-schedules.md) — the claim loop and
  recurring schedules
- [Context & hybrid search](./context-and-search.md) — ingest files,
  folders, and URLs
- [MCPX integration](./mcpx.md) — wire up external services
- [Skills](./skills.md) — slash-command templates the agent can also
  author at runtime
