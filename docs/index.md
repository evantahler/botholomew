---
layout: home

hero:
  name: Botholomew
  text: An AI agent for knowledge work.
  tagline: Point it at your docs, projects, and inboxes and it reads them, remembers them, and works a durable task queue — summarizing, researching, organizing — while you sleep, work, or chat with it. Local, including local LLMs, and built around a large memory store rather than a single chat window.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/evantahler/botholomew

features:
  - title: Memory-first
    details: Built to reason over a large corpus, not a single chat. Ingest hundreds of files and URLs (PDF/DOCX/HTML → markdown) into a local [membot](https://github.com/evantahler/membot) store with hybrid BM25 + semantic search, append-only versioning, and history you can `diff`. Big tool responses pipe into the same store, so the agent works through megabytes of JSON without burning tokens.
  - title: Autonomous
    details: Background workers claim tasks, work them with Claude, and log every interaction. Spawn one-shot workers, a long-running --persist worker, or point cron at `botholomew worker run`.
  - title: Portable
    details: A project is a directory of files — markdown for prompts, tasks, and schedules; CSVs for conversation history. Copy it, share it, `git diff` it, check it in, or `.gitignore` it.
  - title: Your data, your disk
    details: Tasks, schedules, threads, prompts, and skills are all real files you can `vim`, `grep`, and `git`. The knowledge store is a single local DuckDB file managed by [membot](https://github.com/evantahler/membot) — append-only, versioned, queryable.
  - title: Tool use through a gateway
    details: External tools come from MCP servers via MCPX. Run them locally (Gmail, Slack, GitHub) — but the setup Botholomew is tuned for points a single [Arcade](https://www.arcade.dev/) gateway at hundreds of authenticated services, so you handle auth once instead of babysitting a server per tool.
  - title: Safe by default
    details: The agent has no shell and no direct filesystem access. The knowledge store is addressed by `logical_path` (a DB key, not a filesystem path); the remaining file-system paths the agent touches (tasks, schedules, prompts, skills) all route through one sandbox helper (NFC normalization + lstat-walk to reject symlinks).
  - title: Concurrent
    details: Many workers can run at once. Each writes a pidfile and heartbeats; tasks and schedules are claimed via `O_EXCL` lockfiles, and crashed workers get reaped automatically.
  - title: Self-modifying
    details: The agent maintains its own `beliefs.md` and `goals.md` — it learns, updates its priors, and revises its goals as it works. It can also author its own slash-command skills mid-conversation.
---

<div class="full-tour">

![Botholomew chat TUI tour](/full-tour.gif)

</div>

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
  through an [Arcade](https://www.arcade.dev/) gateway — one authenticated
  door to hundreds of services, which is where most of the interesting
  work actually happens.

It's also nerdy by design: every prompt, task, thread, and belief is a
plain file I can open, `grep`, and `git diff`. — Evan

For the honest version — including what I got wrong — see the
[field notes](/field-notes).

## Why Botholomew?

Botholomew has **no shell and no access to your real filesystem**. The
agent's world is a per-project knowledge store managed by
[membot](https://github.com/evantahler/membot) — every read, write,
search, and delete is addressed by `logical_path` (a DB key, not a
filesystem path), so a prompt-injected attempt to reach `~/.ssh/id_rsa`
has nowhere to land. Local files and URLs are brought in through
`botholomew membot add`. External capabilities (email, Slack, the web,
and hundreds of other services) are granted deliberately, per project,
through MCP servers wired up via
[MCPX](https://github.com/evantahler/mcpx).

## Quickstart

```bash
# 1. Install (requires Bun 1.1+)
bun install -g botholomew

# 2. Initialize a project
botholomew init

# 3a. Set your Anthropic API key (Claude is the default; embeddings always run locally)
export ANTHROPIC_API_KEY=sk-ant-...

# 3b. ...or run fully locally with Ollama:
#    ollama serve & ollama pull llama3.1:8b
#    botholomew init --force --provider ollama   # no API key needed

# 4. Queue some work and run a worker
botholomew task add "Summarize every markdown file in ~/notes"
botholomew worker run

# 5. Or chat with the agent interactively
botholomew chat
```

See **[Get started](/getting-started)** for the full walkthrough, then
dive into **[Architecture](/architecture)** to understand the moving
parts.

<div class="llm-callout">

### For LLMs and AI agents

This site is published in LLM-friendly formats too:

- **[/llms.txt](/llms.txt)** — table of contents with links to every documentation page
- **[/llms-full.txt](/llms-full.txt)** — the entire doc set bundled into one file
- Append `.md` to any page URL (e.g. `/architecture.md`) to get the raw markdown source

Point your agent at one of these instead of scraping HTML.

</div>
