# Get started

This page walks you from a clean machine to a running Botholomew worker
processing tasks. For deeper background, see
[Architecture](./architecture.md).

## Prerequisites

- **An Anthropic API key** — Claude is the reasoning model.
- **[Bun](https://bun.sh) 1.1+** — only for the npm/source installs below; the
  prebuilt binary bundles its own runtime and needs neither Bun nor Node.
- Embeddings run locally via `@huggingface/transformers` (default
  `Xenova/bge-small-en-v1.5`, 384-dim). The first call downloads ~33 MB
  of weights into the project's `models/` directory; no API key is
  required.
- Optional: any [MCP servers](./mcpx.md) you want to expose to the agent
  (Gmail, Slack, GitHub, etc.) — managed through
  [MCPX](https://github.com/evantahler/mcpx).

## Install

### Prebuilt binary (no Bun required)

Downloads the single self-contained executable for your platform from the
[latest release](https://github.com/evantahler/botholomew/releases/latest) and
installs it as `botholomew` (with a `bothy` alias):

```bash
curl -fsSL https://raw.githubusercontent.com/evantahler/botholomew/main/install.sh | sh
```

macOS (arm64) and Linux (x64) are supported. On Windows, download
`botholomew-windows-x64.exe` from the releases page. Update in place anytime
with `botholomew upgrade`.

### With Bun (npm registry)

```bash
bun install -g botholomew
```

Either way the CLI installs as both `botholomew` and `bothy` — the same binary,
two names. Examples in these docs use `botholomew`; substitute `bothy` if you
prefer the shorter form.

### From a checkout

```bash
git clone https://github.com/evantahler/botholomew
cd botholomew
bun install
bun run dev -- --help
```

From a checkout you can also compile the standalone binary yourself:

```bash
bun run build      # → dist/bothy (one self-contained file; runs anywhere)
```

It bundles everything — including DuckDB's native library and the local
embedding runtime — into one file. Cross-compile for another platform with
`bun run scripts/build.ts --target=bun-linux-x64` (and the matching arch); CI
builds this matrix and attaches the binaries to each release.

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

## Configure your LLM

Botholomew speaks to language models via the Vercel AI SDK and supports
three providers out of the box: **Anthropic** (Claude, the default),
**Ollama** (local), and any **OpenAI-compatible** endpoint.

### Anthropic (default)

Either export the environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

…or set `llm.api_key` in `config/config.json`.

### Run fully locally with Ollama

```bash
# 1. Start Ollama and pull a tool-capable model
ollama serve &
ollama pull llama3.1:8b

# 2. Initialize a project pre-configured for Ollama
botholomew init --provider ollama
```

That writes an `llm` / `chunker_llm` block pointing at `llama3.1:8b` and
`qwen2.5:3b`. No API key needed. Tool-capable models include
`llama3.1:8b`, `qwen2.5:7b`, `mistral-nemo`, and `command-r`. Models
without the `tools` capability are refused at startup.

### OpenAI-compatible endpoint

```bash
botholomew init --provider openai-compatible
```

then edit `config/config.json` to set `llm.base_url` and `llm.api_key`
for your endpoint (OpenRouter, LM Studio, vLLM, Groq, Together, etc.).

See [Configuration](./configuration.md) for the full LLM block schema.

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
