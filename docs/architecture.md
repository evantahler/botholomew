# Architecture

Botholomew is three cooperating process roles that share a single DuckDB
database:

1. **Workers** — short-lived or long-running `bun` processes that claim
   tasks from the queue, evaluate schedules, and run LLM tool loops.
   Multiple workers can run at once; each registers itself in the DB and
   heartbeats so dead ones are reaped.
2. **The chat TUI** — an Ink/React terminal UI you run on demand; it
   enqueues tasks, browses history, and can dispatch workers via the
   `spawn_worker` tool.
3. **The CLI** — everything else (`task add`, `schedule list`, `context
   search`, `worker list`, …). Each invocation opens its own DuckDB
   connection.

All share `.botholomew/data.duckdb`. DuckDB holds the file lock at the
instance level (not the connection), so **no process holds a DB
connection longer than a single logical operation**. Each CRUD call runs
inside a short-lived `withDb(dbPath, fn)` from `src/db/connection.ts`,
which acquires a connection, executes, and releases the instance when the
last overlapping caller in the process is done. `withRetry` wraps the
acquire path and retries with exponential backoff if another process is
holding the lock.

**Safety note.** None of these processes give the agent direct access to
your machine. Workers are the only things executing LLM tool calls, and
the only tools they see are the ones registered in `src/tools/` (all
operating inside `.botholomew/`) plus whichever MCP servers you
explicitly configured. There is no "just read the file system" escape
hatch. See [the virtual filesystem doc](virtual-filesystem.md) for the
full argument.

---

## The worker tick

A worker executes one `tick()` per cycle. In `--once` mode (the default),
a single tick runs and then the worker exits. In `--persist` mode, the
worker loops over ticks until it receives SIGTERM/SIGINT.

```
 tick() ─┐
         ├─► reset stale in_progress tasks (claimed > 3× max_tick_duration)
         ├─► processSchedules(workerId) — atomically claim each due
         │                                 schedule, ask the LLM which are
         │                                 "due", enqueue their tasks
         ├─► claimNextTask(workerId)   — highest-priority unblocked pending
         │                                 task; worker id is stamped on the
         │                                 `claimed_by` column
         ├─► createThread("worker_tick") — one thread per tick for logging
         ├─► buildSystemPrompt()       — always-context + task-relevant
         │                                 context
         ├─► runAgentLoop()            — multi-turn Anthropic tool-use loop
         │                                 every message, thinking block, tool
         │                                 call, and tool result is logged as
         │                                 an `interaction` row
         ├─► updateTaskStatus()        — complete / failed / waiting
         └─► endThread()
```

If no task is claimable and no schedule is due, `tick()` returns
`false`. A `--persist` worker then sleeps `tick_interval_seconds` before
trying again; a `--once` worker exits immediately.

See `src/worker/tick.ts`.

### Log format

Worker logs (both foreground stdout and `.botholomew/worker.log`) prefix
every line with a local `HH:MM:SS` timestamp. Lifecycle phases render as
`[[phase-name]]` in bold magenta so they're easy to scan and grep
(`grep '\[\[' worker.log`). Phases emitted each tick:

- `[[tick-start]] #N`
- `[[evaluating-schedules]]` (only when any are enabled)
- `[[claiming-task]]`
- `[[tick-end]] #N Xs didWork=true|false`
- `[[sleeping]] Ns` (only when there was no work in a persist worker)

---

## Registration, heartbeat, reaping

Every worker writes a row into the `workers` table on start
(`registerWorker` in `src/db/workers.ts`) with its id (uuidv7), pid,
hostname, mode, optional pinned task id, and `status='running'`. From
that moment, a non-blocking `setInterval` in `src/worker/heartbeat.ts`
bumps `last_heartbeat_at` every
`worker_heartbeat_interval_seconds` (default 15s) — independent of the
tick loop, so a worker mid-LLM-call still heartbeats reliably.

Persist workers also run a reaper interval
(`worker_reap_interval_seconds`, default 30s) that does two things:

1. Flips any worker whose heartbeat is older than
   `worker_dead_after_seconds` (default 60s) to `status='dead'` and
   releases every task and schedule claim it held. This is the
   failure-recovery path: anything from a terminal crash to a `kill -9`
   ends with the work reclaimable by another worker.
2. Deletes cleanly-stopped workers whose `stopped_at` is older than
   `worker_stopped_retention_seconds` (default 3600s). Dead workers are
   kept as forensic evidence; only the clean exits get auto-pruned so
   the `workers` table doesn't grow unbounded.

---

## The chat TUI

`botholomew chat` is a separate agent with its own system prompt and tool
set — it does **not** execute long-running work itself. Instead, it:

- answers questions about tasks, threads, and context,
- creates tasks (via `create_task`) that workers will pick up,
- spawns workers on demand (via `spawn_worker`) when the user wants work
  run right now,
- reads worker activity (`list_threads`, `view_thread`),
- looks up context items by path or UUID (`context_info`, `context_search`)
  and can refresh them in place (`context_refresh`),
- invokes **skills** (`/review`, `/standup`, …) defined in
  `.botholomew/skills/`,
- edits `beliefs.md` and `goals.md` via `update_beliefs` / `update_goals`.

It uses Anthropic's streaming API so tokens render in the TUI as they
arrive. Every session is itself a `chat_session` thread with the same
interaction log as a worker tick.

See `src/chat/` and `src/tui/`.

---

## Why two agents?

A single-agent design would force the chat loop to wait on whatever the
user asked — "summarize this 200-page PDF" blocks the UI for minutes. The
split:

- **Chat** is fast, streaming, and interactive. It understands the world
  via the database but doesn't touch it much.
- **Workers** are slow, autonomous, and batch-oriented. Each tick can
  take as long as it needs.

Both speak to the same database, so a worker's results are immediately
visible to the chat agent — and the chat agent can dispatch workers
without blocking.

---

## Automation without a resident daemon

Earlier versions of Botholomew shipped an OS-level watchdog (launchd on
macOS, systemd on Linux) to keep a single daemon alive. That's been
replaced: users now run workers directly, and there is no installed
background service. See [automation.md](automation.md) for cron-based
recipes and optional launchd/systemd examples if you want Botholomew to
advance on its own.

---

## Thread logging

Every interaction is persisted. A **thread** is one tick or one chat
session; an **interaction** is a single event within it (user message,
assistant message, tool call, tool result, thinking block, status change).

This gives Botholomew total observability without a separate tracing
stack — `botholomew thread view <id>` reads the same rows that produced
the work. Threads are also the chat agent's way of reporting on what
workers have been doing.

Schema lives in `src/db/sql/2-logging_tables.sql`; thread types are
`worker_tick` and `chat_session`.

---

## Connection model

Every process uses the same policy: **open a DuckDB connection for one
logical operation, then close it.**

- **Workers**: `tick()` takes a `dbPath`, not a held connection. Each
  call into `src/db/*` is wrapped in `withDb` — stale-task reset, task
  claim, thread create, every `logInteraction`, the status update. The
  LLM network round-trip holds no connection.
- **Heartbeat**: a separate `setInterval` opens its own short `withDb`
  every ~15s (`src/worker/heartbeat.ts`). This is deliberately decoupled
  from the tick loop so a long LLM call doesn't stall the heartbeat.
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
individual connections. Within one process we refcount a shared instance
so overlapping `withDb` calls (e.g., parallel tool execution via
`Promise.all`, or the heartbeat firing alongside a tick) don't trip
DuckDB's "don't open the same DB twice" rule; when the last caller in the
process releases, we close the instance and free the OS-level lock so
another process can claim it.

The DuckDB VSS extension is loaded at connect time (`INSTALL vss; LOAD
vss;`) and HNSW persistence is enabled so vector indexes survive
restarts. See `src/db/connection.ts`.

---

## Multi-worker safety

Any number of workers can run against the same project concurrently
(spawned by CLI, the chat tool, cron, or `--persist`). Concurrency is
handled at the DB level:

- **Task claim** — `claimNextTask(conn, workerId)` issues an atomic
  `UPDATE tasks SET status='in_progress', claimed_by=?1 WHERE id=?2 AND
  status='pending' RETURNING *`. If another worker claimed the row
  first, `RETURNING` comes back empty and the loop tries the next
  candidate.
- **Schedule claim** — `claimSchedule(conn, id, workerId, opts)` is the
  same atomic UPDATE pattern, gated by both a
  `schedule_claim_stale_seconds` (default 300s) window on the existing
  claim and a `schedule_min_interval_seconds` (default 60s) window on
  `last_run_at`. Only one worker per schedule per window evaluates and
  enqueues tasks.
- **Stale release** — If a worker crashes mid-task, its claim is
  released when the reaper flips its row to `dead`. Existing `claim_at`
  staleness also catches tasks claimed for longer than 3× the tick
  duration, independent of the worker's heartbeat.

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
| `nuke threads` | `threads`, `interactions` (both worker ticks and chat sessions) |
| `nuke all` | everything above plus `daemon_state` |

Each subcommand requires `-y`/`--yes` to actually delete — running
without the flag prints per-table row counts and exits, so it doubles
as a dry run. Nothing on disk (soul, beliefs, goals, config, skills) is
ever touched.

For safety, `nuke` refuses to run while any worker is in `status='running'`
— stop them first with `botholomew worker stop <id>`. The schema itself
(tables, `_migrations`) is always preserved.

See `src/commands/nuke.ts`.
