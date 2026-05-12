# Botholomew Milestones

| # | Milestone | Summary |
|---|-----------|---------|
| 1 | [Foundation](milestone-1-foundation.md) | Scaffolding, DB schema, CLI skeleton, daemon tick loop |
| 2 | [Context & Embeddings](milestone-2-context-and-embeddings.md) | Ingest, chunk, embed, and search content with hybrid vector search |
| 3 | [Schedules & Task Hardening](milestone-3-schedules-and-task-hardening.md) | Recurring schedules, cycle detection, timeouts, full task/schedule CLI |
| 4 | [MCPX Integration](milestone-4-mcpx-integration.md) | External tools via MCP servers (Gmail, Slack, web, etc.) |
| 5 | [Chat TUI](milestone-5-chat-tui.md) | Interactive Ink/React terminal UI for conversational interaction |
| 6 | [Daemon Watchdog & Distribution](milestone-6-daemon-watchdog-and-distribution.md) | Superseded by M9 — OS-level watchdog replaced; agent self-modification retained |
| 7 | [Skills (Slash-Commands)](milestone-7-skills.md) | User-defined slash-commands loaded from `.botholomew/skills/` markdown files |
| 8 | [Remote Context](milestone-8-remote-context.md) | Ingest context from URLs via LLM-driven MCPX tool selection |
| 9 | [Worker Agents](milestone-9-worker-agents.md) | Replace OS watchdog with in-DB worker registration + heartbeats; multi-worker support; chat-dispatched one-shot workers |
| 10 | [Simplify Context Paths](milestone-10-simplify-context-paths.md) | Collapse `source_path` + `context_path` into a single `drive:/path`; drop LLM path placement |
| 11 | [Disk-Backed Project Layout](disk-backed-project-layout.md) | Move context, tasks, and schedules out of DuckDB onto real disk; lockfile claim; sandbox helper |
| 12 | [Generic Prompts CRUD](milestone-12-generic-prompts-crud.md) | Drop the four-file cast; strict Zod-validated frontmatter; full CRUD via CLI + agent tools |
| 13 | [Replace Context with `membot`](milestone-13-replace-context-with-membot.md) | Delete `src/context/` + `src/db/`; consume membot as an SDK; agent learns `membot_*` tools; per-project DuckDB store |

## Stub/TODO Coverage

Every stub and "Coming soon" from M1 is assigned to a milestone:

| Stub | Milestone |
|------|-----------|
| `src/db/context.ts` — context CRUD | M2 |
| `src/db/embeddings.ts` — embedding CRUD + search | M2 |
| `src/commands/context.ts` — context CLI | M2 |
| `@xenova/transformers` dependency | M2 |
| Contextual loading in system prompt | M2 |
| `src/db/schedules.ts` — schedule CRUD | M3 |
| Schedule evaluation + task creation | M3 |
| Circular dependency detection | M3 |
| Task timeout/reset | M3 |
| `src/commands/schedule.ts` — schedule CLI | M3 |
| `src/commands/mcpx.ts` — MCPX CLI | M4 |
| MCPX library integration | M4 |
| MCP tools in daemon agent loop | M4 |
| `src/commands/chat.ts` — chat TUI | M5 |
| `src/tui/App.tsx` — Ink components | M5 |
| Chat agent with streaming | M5 |
| Agent self-modification (beliefs/goals) | M5, M6 |
| `daemon install` command | M6 |
| OS-level watchdog (launchd/systemd) | M6 |
| Binary compilation (`bun build`) | M6 |
