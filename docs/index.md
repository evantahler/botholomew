---
layout: home

hero:
  name: Botholomew
  text: An AI agent for knowledge work.
  tagline: An autonomous agent that works your task queue — reading email, summarizing documents, researching topics, organizing notes, and maintaining context over time — while you sleep, work, or chat with it.
  image:
    src: /full-tour.gif
    alt: Botholomew chat TUI tour
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
    details: Each project is a `.botholomew/` directory — markdown plus DuckDB. Copy it, share it, check it in, or .gitignore it.
  - title: Your data, your disk
    details: Tasks, threads, ingested context, and embeddings live locally in DuckDB with BM25 keyword search and `array_cosine_distance` vector search. Model calls go direct to Anthropic and OpenAI.
  - title: Extensible
    details: External tools come from MCP servers via MCPX — run them locally (Gmail, Slack, GitHub) or connect through a gateway like Arcade.dev to reach hundreds of authenticated services.
  - title: Safe by default
    details: The agent has no shell and no direct filesystem access. Out of the box, everything it can touch lives in `.botholomew/`; every external capability is an MCP server you explicitly add.
  - title: Concurrent
    details: Many workers can run at once. Each registers itself in the DB and heartbeats; crashed workers get reaped and their tasks go back into the queue automatically.
  - title: Self-modifying
    details: The agent maintains its own `beliefs.md` and `goals.md` — it learns, updates its priors, and revises its goals as it works. It can also author its own slash-command skills mid-conversation.
---

## Why Botholomew?

Unlike coding agents, Botholomew has **no shell and no direct access to
your filesystem**. It can't edit files on disk — instead, it ingests local
files, folders, and URLs into a DuckDB-backed context store that it can
read, search, and summarize. External capabilities (email, Slack, the
web, and hundreds of other services) are granted deliberately, per
project, through MCP servers wired up via
[MCPX](https://github.com/evantahler/mcpx).

## Quickstart

```bash
# 1. Install (requires Bun 1.1+)
bun install -g botholomew

# 2. Initialize a project
botholomew init

# 3. Set your API keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...   # used for embeddings

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
