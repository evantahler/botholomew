# Architecture

Botholomew is four cooperating processes that share a single DuckDB database:

1. **The daemon** — a long-running `bun` process that ticks, claims tasks,
   and runs LLM tool loops.
2. **The chat TUI** — an Ink/React terminal UI you run on demand; it
   enqueues tasks and browses history.
3. **The OS watchdog** — `launchd` on macOS, `systemd` on Linux; runs a
   health-check every 60 seconds to keep the daemon alive.
4. **The CLI** — everything else (`task add`, `schedule list`, `context
   search`, …). Each invocation opens its own DuckDB connection.

All four share `.botholomew/data.duckdb`. DuckDB holds the file lock at
the instance level (not the connection), so **no process holds a DB
connection longer than a single logical operation**. Each CRUD call runs
inside a short-lived `withDb(dbPath, fn)` from `src/db/connection.ts`,
which acquires a connection, executes, and releases the instance when the
last overlapping caller in the process is done. `withRetry` wraps the
acquire path and retries with exponential backoff if another process is
holding the lock.

**Safety note.** None of these processes give the agent direct access
to your machine. The daemon is the only thing executing LLM tool
calls, and the only tools it sees are the ones registered in
`src/tools/` (all operating inside `.botholomew/`) plus whichever MCP
servers you explicitly configured. There is no "just read the file
system" escape hatch. See [the virtual filesystem
doc](virtual-filesystem.md) for the full argument.

---

## The daemon tick loop

Every `tick_interval_seconds` (default 300s), the daemon performs one
`tick()`:

```
 tick() ─┐
         ├─► reset stale in_progress tasks (claimed > 3× max_tick_duration)
         ├─► processSchedules() — ask the LLM which schedules are "due"
         │                         and enqueue the tasks they describe
         ├─► claimNextTask()   — highest-priority unblocked pending task
         ├─► createThread()    — one thread per tick for logging
         ├─► buildSystemPrompt() — always-context + task-relevant context
         ├─► runAgentLoop()    — multi-turn Anthropic tool-use loop
         │                         every message, thinking block, tool call,
         │                         and tool result is logged as an
         │                         `interaction` row
         ├─► updateTaskStatus() — complete / failed / waiting
         └─► endThread()
```

If no task is claimable and no schedule is due, `tick()` returns `false` and
the daemon sleeps until the next interval. If work was done, it ticks again
immediately — so a backlog drains as fast as the LLM can process it.

See `src/daemon/tick.ts`.

### Log format

Daemon logs (both foreground stdout and `.botholomew/daemon.log`) prefix
every line with a local `HH:MM:SS` timestamp. Lifecycle phases render as
`[[phase-name]]` in bold magenta so they're easy to scan and grep
(`grep '\[\[' daemon.log`). Phases emitted each tick:

- `[[tick-start]] #N`
- `[[evaluating-schedules]]` (only when any are enabled)
- `[[claiming-task]]`
- `[[tick-end]] #N Xs didWork=true|false`
- `[[sleeping]] Ns` (only when there was no work)

---

## The chat TUI

`botholomew chat` is a separate agent with its own system prompt and tool
set — it does **not** execute long-running work itself. Instead, it:

- answers questions about tasks, threads, and context,
- creates tasks (via the `create_task` tool) that the daemon will pick up,
- reads daemon activity (`list_threads`, `view_thread`),
- looks up context items by path or UUID (`context_info`, `context_search`)
  and can refresh them in place (`context_refresh`),
- invokes **skills** (`/review`, `/standup`, …) defined in
  `.botholomew/skills/`,
- edits `beliefs.md` and `goals.md` via `update_beliefs` / `update_goals`.

It uses Anthropic's streaming API so tokens render in the TUI as they
arrive. Every session is itself a `chat_session` thread with the same
interaction log as a daemon tick.

See `src/chat/` and `src/tui/`.

---

## Why two agents?

A single-agent design would force the chat loop to wait on whatever the
user asked — "summarize this 200-page PDF" blocks the UI for minutes. The
split:

- **Chat** is fast, streaming, and interactive. It understands the world
  via the database but doesn't touch it much.
- **Daemon** is slow, autonomous, and batch-oriented. It can take as long
  as it needs per tick.

Both speak to the same database, so the daemon's results are immediately
visible to the chat agent.

---

## Thread logging

Every interaction is persisted. A **thread** is one tick or one chat
session; an **interaction** is a single event within it (user message,
assistant message, tool call, tool result, thinking block, status change).

This gives Botholomew total observability without a separate tracing
stack — `botholomew thread view <id>` reads the same rows that produced
the work. Threads are also the chat agent's way of reporting on what the
daemon has been doing.

Schema lives in `src/db/sql/2-logging_tables.sql`.

---

## Connection model

Every process uses the same policy: **open a DuckDB connection for one
logical operation, then close it.**

- **Daemon**: `tick()` takes a `dbPath`, not a held connection. Each call
  into `src/db/*` is wrapped in `withDb` — stale-task reset, task claim,
  thread create, every `logInteraction`, the status update. The LLM
  network round-trip holds no connection.
- **Chat**: `ChatSession` carries `dbPath`. Each write (user message
  log, tool-use log, tool-result log, title update, thread end) is its
  own `withDb`. Tool execution wraps each call in `withDb` so `ctx.conn`
  is scoped to that tool call only.
- **CLI invocations**: `withDb` in `src/commands/with-db.ts` opens a
  connection for the command, applies migrations, and closes when the
  callback returns.
- **TUI panels**: take `dbPath`, not `conn`, and wrap each refresh poll
  in `withDb`.

DuckDB's file lock is process-wide and held by the *instance*, not
individual connections. Within one process we refcount a shared
instance so overlapping `withDb` calls (e.g., parallel tool execution
via `Promise.all`) don't trip DuckDB's "don't open the same DB twice"
rule; when the last caller in the process releases, we close the
instance and free the OS-level lock so another process can claim it.

The DuckDB VSS extension is loaded at connect time (`INSTALL vss; LOAD
vss;`) and HNSW persistence is enabled so vector indexes survive
restarts. See `src/db/connection.ts`.

---

## Process lifecycle

```
 install           start              healthcheck          uninstall
    │                │                     │                   │
    ▼                ▼                     ▼                   ▼
 launchd        PID file          every 60s:               remove
 plist /        written to      read PID, check            plist/unit,
 systemd       daemon.pid       isAlive(), spawn          stop service
  unit                            daemon if not
```

The watchdog doesn't run the daemon directly (`KeepAlive: false` on
macOS) — it runs `healthcheck.ts`, which is cheap and idempotent. See
[the watchdog doc](watchdog.md).

---

## Nuke: bulk database resets

During development and when reusing a project, you often want to wipe
part of the database without blowing away the whole `.botholomew/`
directory (which would also erase `soul.md`, `beliefs.md`, `goals.md`,
`config.json`, and your skills). `botholomew nuke` covers that:

| Scope | Clears |
|---|---|
| `nuke context` | `context_items`, `embeddings` |
| `nuke tasks` | `tasks` |
| `nuke schedules` | `schedules` |
| `nuke threads` | `threads`, `interactions` (both daemon ticks and chat sessions) |
| `nuke all` | everything above plus `daemon_state` |

Each subcommand requires `-y`/`--yes` to actually delete — running
without the flag prints per-table row counts and exits, so it doubles
as a dry run. Nothing on disk (soul, beliefs, goals, config, skills) is
ever touched.

For safety, `nuke` refuses to run while the daemon is alive — stop it
first with `botholomew daemon stop`. The schema itself (tables,
`_migrations`) is always preserved.

See `src/commands/nuke.ts`.
