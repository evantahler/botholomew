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

The CLI installs as both `botholomew` and `bothy` — the same binary, two
names. Examples in these docs use `botholomew`; substitute `bothy` if
you prefer the shorter form.

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
  config/config.json                # models, tick interval, API keys, scope settings
  prompts/                          # markdown loaded into every system prompt (or keyword-loaded)
    goals.md                        #   identity + current goals (agent-editable)
    beliefs.md                      #   agent-editable priors
    capabilities.md                 #   auto-generated tool inventory
  skills/                           # slash commands (built-ins + user-defined)
  tasks/<id>.md                     # tasks (status in frontmatter)
  schedules/<id>.md                 # schedules
  threads/<YYYY-MM-DD>/<id>.csv     # conversation history
  workers/<id>.json                 # worker pidfile + heartbeat
  logs/<YYYY-MM-DD>/<id>.log        # per-worker logs
```

By default the knowledge store (`membot`) and MCP server config (`mcpx`)
are **shared globally** at `~/.membot/` and `~/.mcpx/`, so personal
knowledge and authenticated MCP servers carry across every Botholomew
project on the machine. Pass `--membot-scope=project` or
`--mcpx-scope=project` to `botholomew init` (or flip the corresponding
key in `config/config.json` later) to use project-local
`<projectDir>/index.duckdb` and `<projectDir>/mcpx/` instead. See
[Configuration → Per-project vs. global](./configuration.md#per-project-vs-global).

The agent has no shell and no filesystem-path surface to its knowledge
store — every entry is addressed by `logical_path` (an opaque DB key).
See [The knowledge store](./files.md) for the full tool surface, and
[Context & search](./context-and-search.md) for how ingestion / search /
versioning work via membot.

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
