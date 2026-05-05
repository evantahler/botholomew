# Architecture

Botholomew is three cooperating process roles that share a project
directory on disk:

1. **Workers** — short-lived or long-running `bun` processes that claim
   tasks from the queue, evaluate schedules, and run LLM tool loops.
   Multiple workers can run at once; each writes a pidfile under
   `workers/<id>.json` and heartbeats so dead ones are reaped.
2. **The chat TUI** — an Ink/React terminal UI you run on demand; it
   enqueues tasks, browses history, and can dispatch workers via the
   `spawn_worker` tool.
3. **The CLI** — everything else (`task add`, `schedule list`, `context
   search`, `worker list`, …).

The project root is just a directory. **Tasks, schedules, threads, and
the agent's context tree are all real files** — markdown with
frontmatter for tasks/schedules/prompts, CSV for conversation history,
plain files for `context/`. The only opaque artifact is `index.duckdb`,
a search-index sidecar over `context/` that's fully derivable from disk
and safe to delete (rebuilt by `botholomew context reindex`).

Concurrency is filesystem-level, not DB-level:

- **Tasks and schedules** are claimed by creating a lockfile under
  `tasks/.locks/<id>.lock` or `schedules/.locks/<id>.lock` with
  `open(O_CREAT|O_EXCL|O_WRONLY)`. EEXIST means another worker holds
  it; the loop tries the next candidate.
- **Status updates** (e.g., flipping a task to `complete`) are
  atomic-write-via-rename on the canonical `<id>.md` file with an mtime
  check, so a user editing the same file in `vim` mid-claim makes the
  worker abort cleanly rather than clobber the edit.
- **Index DB writes** (only the `botholomew context reindex` and
  in-process indexers do these) still run under `withDb(dbPath, fn)`
  from `src/db/connection.ts` for a short-lived connection; DuckDB
  remains a single-writer-at-a-time store, but it's no longer the
  source of truth.

**Safety note.** Workers are the only things executing LLM tool calls,
and every path-taking tool routes through a single sandbox helper
(`src/fs/sandbox.ts::resolveInRoot`) that NFC-normalizes the input,
rejects `..`/absolute/NUL paths, and `lstat`-walks each component.
Read-side `context_*` ops (read, list, tree, info, search, reindex,
delete) opt in to symlinks via `allowSymlinks: true` so users can drop
symlinks into the agent's tree, but mutating ops (write, edit, move,
copy, mkdir) never set the flag and reject any symlink component. Tools
are pinned to `context/`;
`models/`, `logs/`, `tasks/.locks/`, and `schedules/.locks/` are
explicitly off-limits. There is no "just read the file system" escape
hatch. See [the files doc](files.md) for the full argument.

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
         │                                 task; worker id is written into
         │                                 the `tasks/.locks/<id>.lock` body
         ├─► createThread("worker_tick") — one thread per tick for logging
         ├─► buildSystemPrompt()       — always-context + task-relevant
         │                                 context
         ├─► runAgentLoop()            — multi-turn Anthropic tool-use loop
         │                                 every message, thinking block, tool
         │                                 call, and tool result is logged as
         │                                 an interaction row in the thread CSV
         │                                 at `threads/<YYYY-MM-DD>/<id>.csv`
         ├─► updateTaskStatus()        — complete / failed / waiting
         └─► endThread()
```

If no task is claimable and no schedule is due, `tick()` returns
`false`. A `--persist` worker then sleeps `tick_interval_seconds` before
trying again; a `--once` worker exits immediately.

See `src/worker/tick.ts`.

### Log format

Worker logs prefix every line with a local `HH:MM:SS` timestamp. Lifecycle
phases render as `[[phase-name]]` in bold magenta so they're easy to scan
and grep (`grep '\[\[' logs/*/<id>.log`). Phases emitted each tick:

- `[[tick-start]] #N`
- `[[evaluating-schedules]]` (only when any are enabled)
- `[[claiming-task]]`
- `[[tick-end]] #N Xs didWork=true|false`
- `[[sleeping]] Ns` (only when there was no work in a persist worker)

Background workers (spawned without a TTY) also mirror the conversation
thread to the log between `[[claiming-task]]` and `Task ... -> complete`,
so a `tail -f` shows what the LLM is actually doing:

- `[[assistant]] <full text response>` — assistant message blocks
- `[[tool-call]] <tool> <truncated JSON input>` — each tool invocation
- `[[tool-result]] <tool> ok|err in Ns` — tool outcome and duration

Full content (untruncated input, tool output, tokens) lands in the
thread CSV under `threads/<YYYY-MM-DD>/<id>.csv`; the log mirrors
enough to follow the trace without opening the CSV. Foreground workers
(`worker run`) keep their existing
streaming UX (per-token output and `▶`/`✓` markers) — these phase lines
are suppressed there to avoid duplication.

---

## Registration, heartbeat, reaping

Every worker writes a pidfile at `workers/<worker-id>.json` on start
(`registerWorker` in `src/workers/store.ts`) containing its id (uuidv7),
pid, hostname, mode, optional pinned task id, optional `log_path`, and
`status='running'`. Detached workers (spawned via `worker start` or
`spawn_worker`) also get a per-worker log file at
`logs/<YYYY-MM-DD>/<worker-id>.log` (date subdir derived from the
worker's uuidv7 timestamp). Foreground workers (`worker run`) have
`log_path = null` and write to stdout instead.

From that moment, a non-blocking `setInterval` in
`src/worker/heartbeat.ts` rewrites the pidfile with a bumped
`last_heartbeat_at` every `worker_heartbeat_interval_seconds` (default
15s) — independent of the tick loop, so a worker mid-LLM-call still
heartbeats reliably.

Persist workers also run a reaper interval
(`worker_reap_interval_seconds`, default 30s) that does two things:

1. Flips any worker whose heartbeat is older than
   `worker_dead_after_seconds` (default 60s) to `status='dead'` and
   unlinks any orphaned task/schedule lockfiles whose body names that
   worker. This is the failure-recovery path: anything from a terminal
   crash to a `kill -9` ends with the work reclaimable by another
   worker on the next tick.
2. Deletes cleanly-stopped pidfiles whose `stopped_at` is older than
   `worker_stopped_retention_seconds` (default 3600s). Dead pidfiles
   are kept as forensic evidence; only the clean exits get auto-pruned
   so `workers/` doesn't grow unbounded.

---

## The chat TUI

`botholomew chat` is a separate agent with its own system prompt and tool
set — it does **not** execute long-running work itself. Instead, it:

- answers questions about tasks, threads, and context,
- creates tasks (via `create_task`) that workers will pick up,
- spawns workers on demand (via `spawn_worker`) when the user wants work
  run right now,
- reads worker activity (`list_threads`, `view_thread`, `search_threads`),
- looks up files by path (`context_info`, `context_search`) and can
  refresh ingested URLs in place (`context_refresh`),
- invokes **skills** (`/review`, `/standup`, …) defined in `skills/`,
- edits `beliefs.md` and `goals.md` via `update_beliefs` / `update_goals`,
- can `sleep` for a fixed duration (1 s – 1 h) when it's deliberately
  waiting on background work — the TUI shows a progress bar and `Esc`
  cancels the wait.

It uses Anthropic's streaming API so tokens render in the TUI as they
arrive. Every session is itself a `chat_session` thread written to its
own CSV under `threads/<YYYY-MM-DD>/<id>.csv` — the same format as a
worker tick.

See `src/chat/` and `src/tui/`.

---

## Why two agents?

A single-agent design would force the chat loop to wait on whatever the
user asked — "summarize this 200-page PDF" blocks the UI for minutes. The
split:

- **Chat** is fast, streaming, and interactive. It reads the project
  directory but writes very little.
- **Workers** are slow, autonomous, and batch-oriented. Each tick can
  take as long as it needs.

Both share the same project directory, so a worker's outputs (a task's
new `status: complete` frontmatter, a freshly-written `context/` file,
a closed thread CSV) are immediately visible to the chat agent — and
the chat agent can dispatch workers without blocking.

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
assistant message, tool call, tool result, thinking block, status
change).

Threads live as plain CSV files at
`threads/<YYYY-MM-DD>/<id>.csv` — the date subdir is derived from the
thread's uuidv7 timestamp so the path is a pure function of the id.
Each row is one interaction; the first row carries the thread's own
metadata as JSON in the `content` column (`role=system`,
`kind=thread_meta`). RFC-4180 escaping handles commas, quotes, and
embedded newlines in agent output.

Two consequences of being plain files:

- `botholomew thread view <id>` reads the CSV. So does `vim`, `less`,
  `csvlens`, and `awk`. There is no schema to migrate.
- The agent has its own `search_threads` tool that regex-walks every
  thread; results pair `(thread_id, sequence)` so the model can hand
  the sequence to `view_thread({ offset })` and read context around the
  hit. Threads are deliberately *outside* `context/` so
  `botholomew context reindex` doesn't drag conversation history into
  the search index.

Thread types are `worker_tick` and `chat_session`. CSV schema lives in
`src/threads/store.ts`.

---

## Connection model

Most state is on disk, so most operations don't touch DuckDB at all.
The index DB is opened only when something needs the search index:

- **Workers**: `tick()` is mostly file IO — `claim` writes a lockfile,
  `logInteraction` appends to a CSV, status updates atomic-rename a
  markdown file. The DB only opens when a tool calls into the search
  path (`context_search`, post-write reindex of a single path). Those
  paths are wrapped in `withDb(dbPath, fn)` from
  `src/db/connection.ts`, which acquires a connection, runs the
  callback, and closes immediately.
- **Heartbeat**: rewrites the worker's pidfile. No DB.
- **Chat**: each turn writes thread interactions to CSV; tools that
  read or write the search index wrap their DB touches in `withDb`.
- **CLI invocations**: `withDb` in `src/commands/with-db.ts` opens a
  connection only for commands that need it (e.g.,
  `botholomew context reindex`, `botholomew context search`), applies
  migrations, and closes when the callback returns.
- **`botholomew context reindex` is the single batch writer**: it
  acquires a file lock and refuses to run while a worker is up, since
  DuckDB is single-writer and overlapping reindexes would conflict.

DuckDB's file lock is process-wide and held by the *instance*, not
individual connections. Within one process we refcount a shared instance
so overlapping `withDb` calls (e.g., parallel tool execution via
`Promise.all`) don't trip DuckDB's "don't open the same DB twice" rule;
when the last caller in the process releases, we close the instance and
free the OS-level lock so another process can claim it.

Vector search uses `array_cosine_distance()` (core DuckDB, no
extension) over a linear scan of the `context_index.embedding` column;
the FTS extension (`INSTALL fts; LOAD fts;`) is loaded at connect time
for BM25 keyword search. See `src/db/connection.ts`.

---

## Multi-worker safety

Any number of workers can run against the same project concurrently
(spawned by CLI, the chat tool, cron, or `--persist`). Concurrency is
handled at the **filesystem** level — the kernel does the arbitration:

- **Task claim** — `claimNextTask(projectDir, workerId)` walks
  candidate `tasks/<id>.md` files (highest priority, unblocked, status
  `pending`) and tries `open(O_CREAT|O_EXCL|O_WRONLY)` on the lockfile
  `tasks/.locks/<id>.lock` for each. The first worker wins; the rest
  get `EEXIST` and try the next candidate. The lockfile body contains
  the winning worker's id and `claimed_at`.
- **Schedule claim** — Same model on `schedules/.locks/<id>.lock`,
  additionally gated by a `schedule_min_interval_seconds` window on the
  schedule's `last_run_at` frontmatter so a tight tick loop doesn't
  re-evaluate too often.
- **Status updates are atomic-write-via-rename with an mtime check**:
  read the canonical `<id>.md`, build the new content with updated
  frontmatter, write to a temp file, `fs.rename` over the original. If
  the user (or another process) has touched the file since we read it,
  we abort and retry next tick rather than clobber their edit.
- **Filesystem compatibility** — `fs.rename` and `O_EXCL` are
  unreliable on sync-overlay filesystems (iCloud, Dropbox, Google
  Drive, OneDrive) and NFS, so `botholomew init` and worker startup
  refuse to run there unless `--force` is passed.
- **Crash recovery** — If a worker crashes mid-task, its lockfile
  outlives it. The reaper (above) walks `tasks/.locks/` and
  `schedules/.locks/`, looks up each lockfile's worker id in
  `workers/`, and unlinks any whose owner is dead or missing. Stale
  in-progress tasks are also reset by `resetStaleTasks()` if their
  claim window exceeds 3× `max_tick_duration_seconds`.

---

## Nuke: bulk project resets

During development and when reusing a project, you often want to wipe
one area of state without blowing away your prompts, skills, or config.
`botholomew nuke` covers that:

| Scope | Clears |
|---|---|
| `nuke context` | `context/` tree + the search index over it |
| `nuke tasks` | every `tasks/<id>.md` and any orphaned task lockfiles |
| `nuke schedules` | every `schedules/<id>.md` and any orphaned schedule lockfiles |
| `nuke threads` | every `threads/<date>/<id>.csv` (worker ticks + chat sessions) |
| `nuke all` | everything above |

Each subcommand requires `-y`/`--yes` to actually delete — running
without the flag prints counts and exits, so it doubles as a dry run.
Prompts (`prompts/{soul,beliefs,goals,capabilities}.md`), skills,
config, and MCPX server config are never touched.

For safety, `nuke` refuses to run while any worker pidfile is alive —
stop them first with `botholomew worker stop <id>`.

See `src/commands/nuke.ts`.

---

## DB doctor: detect and repair index corruption

Under rare circumstances — typically after a hard crash or interrupted
write — DuckDB's primary-key index can fall out of sync with the row
data. The symptom is that `UPDATE`/`DELETE` against the affected rows
fails with `Invalid Input Error: Failed to delete all rows from index`.
Inside Bun, that FATAL error unwinds past the NAPI boundary as a C++
exception, surfacing as `panic: A C++ exception occurred` from
`Zig__GlobalObject__onCrash`.

Because the index DB is now derivable from `context/`, the simplest
recovery is to just delete `index.duckdb` and run
`botholomew context reindex --full`. `botholomew db doctor` is still
available for cases where you want to preserve the existing index:

| Mode | What it does |
|---|---|
| `db doctor` (default) | Probes each table in `index.duckdb` in a child Bun process. Reports `ok` / `empty` / `missing` / `corrupt` per table. The child-process isolation is essential — a panic in the probe stays out of the doctor itself. |
| `db doctor --repair` | Refuses if any worker pidfile is alive. Runs `CHECKPOINT`, `EXPORT DATABASE` to a timestamped directory, renames the original `index.duckdb` (and `.wal`) to `index.duckdb.bak-<timestamp>`, opens a fresh DB at the original path, and `IMPORT DATABASE`s back. Indexes are rebuilt from data, which restores write integrity. |

Repair is idempotent and non-destructive: the original DB is preserved
as a `.bak-<timestamp>` file next to the new one. Delete the backup once
you've confirmed the rebuilt index looks right.

See `src/db/doctor.ts` and `src/commands/db.ts`.
