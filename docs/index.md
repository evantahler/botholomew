---
layout: home

hero:
  name: Botholomew
  text: An AI agent for knowledge work.
  tagline: An autonomous agent that works your task queue — reading email, summarizing documents, researching topics, organizing notes, and maintaining context over time — while you sleep, work, or chat with it.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/evantahler/botholomew

features:
  - title: Autonomous
    details: Background workers claim tasks, work them with Claude, and log every interaction. Spawn one-shot workers, a long-running --persist worker, or point cron at `botholomew worker run`.
  - title: Portable
    details: A project is a directory of files — markdown for prompts, tasks, and schedules; CSVs for conversation history. Copy it, share it, `git diff` it, check it in, or `.gitignore` it.
  - title: Your data, your disk
    details: Tasks, schedules, threads, prompts, and skills are all real files you can `vim`, `grep`, and `git`. The knowledge store is a single local DuckDB file managed by [membot](https://github.com/evantahler/membot) — append-only, versioned, queryable.
  - title: Extensible
    details: External tools come from MCP servers via MCPX — run them locally (Gmail, Slack, GitHub) or connect through a gateway like Arcade.dev to reach hundreds of authenticated services.
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

# 3. Set your Anthropic API key (embeddings run locally — no other key needed)
export ANTHROPIC_API_KEY=sk-ant-...

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
