# Prompt

We are going to create an AI Agent called Botholomew.  This agent is inspired by, but different than claude code in that it is focused on knowledge work rather than coding.

1. It does not have access to a shell / the user's computer. No direct file-system access.
2. It is written from the beginning to work with its components distributed (orchestrator, tool execution, memory, context), rather than in one process.  This makes it possible to run locally and on the web.
3. It has multiple interfaces.  We are starting with a TUI and website.

We get some inspiration form OpenClaw:

* A heartbeat to keep things moving
* A tied context system: persistent (Soul, Beliefs, Goals), and then built in context tools.

## How it works

Daemon + Chat

### Daemon

Thee's a botholomew daemon running for each project (folder) that runs for a 'tick', sleeps, and then starts again with fresh context.  The daemon works though schedules and tasks in the project's database.  At a high-level, there's an OS-level trigger every minute that then looks for all botholomew instances, and ticks them if needed.

### Chat

This is the interactive session that the user has with the agent.  This agent doesn't work tasks itself, but enqueues them for the daemon to work on. It does have access to all the results of the work and the context that was built up by the daemon.

### It's all files

Each botholomew project ends up as a collection of file (markdown and duckdb), so it's portable and shareable!

## Tools

All tools are executed via MCPX (<https://github.com/evantahler/mcpx>) via the TypeScript SDK.  This allows the operator to manually add / remove tools for the agent, and have a first-class MCP experience.  We will use a custom MCPX registry per-project, stored in `.botholomew/mcpx`.

## Persistent Context

The folder the agent runs from will be looking for a `.botholomew` directory, and then markdown files within.  Use front-matter to determine if:

* a file should be loaded "always" or "contextually".  
* the agent is allowed to modify it's own files (agent-modification: true/false)

New projects will start with a "soul.md", "beliefs.md", and "goals.md" which are "always" loaded.  "beliefs.md", and "goals.md" are agent-editable, soul is not.

## Dynamic Context

in each `.botholomew` directory, there's also a "data" duckdb file.  This will power a number of things:

* Tasks
* Schedules
* Context
* Memories

### Tasks

Tasks are TODOs the agent or human has set up to complete.  

The tasks table contains created/update/ids, and: 

* task name
* task description
* priority (low, medium, high)
* (array) links relevant context items (FKs)
* claimed-by
* claimed-at
* status (enum: [pending, in-progress, failed, complete, waiting])
* waiting reason (e.g. rate-limited, needs human clarification, etc)
* blocked by (links to tasks that need to be complete first before this one can be worked on)

When the agent wakes up, it will pluck an unclaimed, unblocked task from teh queue, in priority order, and try to do it.  

It will be impossible to enqueue tasks which cannot unwind their dependency DAG.

The agent can also decide to reset a task that is taking too long, and try again

The task system will need to provide tools to the LLM to work with them.  Check out https://www.synchzor.com/docs/cli for inspiration

### Schedules

Schedules are recurring work items which will enqueue tasks when it is time to do them, (e.g. "check my email every morning and make me a summary" will produce a "read email" and "produce summary" task).  

The schedules table contains created/update/ids, and:

* schedule name
* schedule description
* schedule frequency (plain text, not CRON) (e.g. "every morning")
* last-run-at (the last time this schedule was processed)

We will need to provide LLM tools for this.

### Context

This is the big one.  We are building a hybrid search system with chunking.  Context items conceptually live in folders, and can be textual (markdown, text, etc) or binary (pdf, image, etc).  The agent can produce context from tool use (e.g. save a copy of a google doc it read) or manually provided by the human operator via the Botholomew CLI (e.g. `Botholomew context add /path/to/dir`).

Context, when added, is stored in the database, so we can have everything in one place, via a context table like:

The context table contains created/update/ids, and:

* content (text or binary)
* mime-type
* it-textual (bool)
* indexed-at (so we can track re-indexing activities)
* title
* description (the LLM produces this)
* source-path (e.g. the folder or url the item came from initially)
* context-path (in the "virtual file system" of the context database)

We also chunk and vectorize/embed the content so we can do both traditional/keyword AND hybrid search.  When a piece of  content is added, we can use local @huggingface/transformers and Xenova/bge-small-en-v1.5 to do this locally without needing a 3d party.  

Chunking strategy will be determined by the LLM after reading each piece of content. The embedding will contain:

* chunk-content (if textual)
* description (always present, LLM generated)
* title
* source-path

The context system will need to provide tools to the LLM to work with them.  Check out https://www.synchzor.com/docs/cli for inspiration

## System Prompt

The system prompt for Botholomew will be static, explaining what the agent is, and that it should work the task/schedule system on each tick.

* include meta information: current date/time, current user, current directory, Botholomew info (version, os, etc)

## Configuration

in `.botholomew/config.json`, we will let folks control:

* ANTHROPIC_API_KEY
* TICK_FREQUENCY
* SYSTEM_PROMPT

## Interface

There's a `botholomew` CLI command with sub-commands:

* `botholomew chat` - the main command to open the interactive chat TUI.  This should look and feel as much like claude code as possible.  This is the multi-turn agent.
* `botholomew context *` - tools for viewing, searching, adding, removing and otherwise managing context for this project
* `botholomew mcpx *` - re-exporting the relevant mcpx tools so that operators can set up the MCP servers they need, test tool calls, etc.
* `botholomew task *` - tools for viewing, searching, adding, removing and otherwise managing tasks for this project
* `botholomew daemon *` - tools for installing, managing, etc the daemon instances of botholomew running on this machines.  This includes first-time setup for the host OS and registering a botholomew project with the OS manager.

And meta-utils (help, version, upgrade)

## Meta

This is a bun + TS project.  This allows us to make and ship binaries easily, do pretty markdown rendering, etc.  Use lots of terminal colors and tui effects.  Use commanderJS for the CLI.