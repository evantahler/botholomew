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
worker pidfiles are real files** — markdown with frontmatter for
tasks/schedules/prompts/skills, CSV for conversation history, JSON for
worker pidfiles. The agent's *knowledge store* lives in `index.duckdb`,
managed by the [`membot`](https://github.com/evantahler/membot) library —
membot owns the schema, the ingestion pipeline, and the search index.

Concurrency:

- **Tasks and schedules** are claimed by creating a lockfile under
  `tasks/.locks/<id>.lock` or `schedules/.locks/<id>.lock` with
  `open(O_CREAT|O_EXCL|O_WRONLY)`. EEXIST means another worker holds
  it; the loop tries the next candidate.
- **Status updates** (e.g., flipping a task to `complete`) are
  atomic-write-via-rename on the canonical `<id>.md` file with an mtime
  check, so a user editing the same file in `vim` mid-claim makes the
  worker abort cleanly rather than clobber the edit.
- **Knowledge-store writes** (`membot_add`, `membot_write`,
  `membot_edit`, `membot_move`, `membot_delete`, `membot_refresh`) go
  through membot's `MembotClient`. Membot manages its own DuckDB lock
  per-operation with exponential backoff, so multiple in-process
  consumers (worker, chat session, TUI Context panel) share the file
  safely. Every write creates a new `version_id` rather than mutating in
  place — there is no read-modify-write race to lock around.

**Safety note.** Workers are the only things executing LLM tool calls,
and every path-taking tool routes through a single sandbox helper
(`src/fs/sandbox.ts::resolveInRoot`) that NFC-normalizes the input,
rejects `..`/absolute/NUL paths, and `lstat`-walks each component. The
helper is general — tasks, schedules, prompts, and skills all depend on
it. The agent's knowledge store has no filesystem-path surface at all:
membot addresses entries by `logical_path` (an opaque DB key), so a
prompt-injected attempt to read `~/.ssh/id_rsa` has nowhere to land.
`logs/`, `tasks/.locks/`, and `schedules/.locks/` are explicitly
off-limits via `PROTECTED_AREAS`. See [the files doc](files.md) for the
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
- looks up files by path (`membot_info`, `membot_search`) and can
  refresh ingested URLs in place (`membot_refresh`),
- invokes **skills** (`/review`, `/standup`, …) defined in `skills/`,
- manages prompt files in `prompts/` via the `prompt_*` tools
  (`prompt_list`, `prompt_read`, `prompt_create`, `prompt_edit`,
  `prompt_delete`). Files marked `agent-modification: false` are
  protected from edits and deletes,
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
new `status: complete` frontmatter, a freshly-written membot entry, a
closed thread CSV) are immediately visible to the chat agent — and the
chat agent can dispatch workers without blocking.

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
  hit. Threads are deliberately outside the membot knowledge store so
  conversation history doesn't drag itself into hybrid search results.

Thread types are `worker_tick` and `chat_session`. CSV schema lives in
`src/threads/store.ts`.

---

## Connection model

Most state is on disk, so most operations don't touch DuckDB at all.
The membot store is opened lazily — every Botholomew process holds one
`MembotClient` at most:

- **Workers**: `tick()` is mostly file IO — `claim` writes a lockfile,
  `logInteraction` appends to a CSV, status updates atomic-rename a
  markdown file. The membot client is only reached when a tool reads
  or writes the knowledge store; each `ctx.mem.<op>` claims membot's DB
  lock for one operation and releases it.
- **Heartbeat**: rewrites the worker's pidfile. No DB.
- **Chat**: each turn writes thread interactions to CSV; the same
  `ctx.mem` is shared across tool calls in one turn.
- **CLI invocations**: `botholomew context <verb>` is a passthrough to
  the `membot` binary — it spawns a fresh process with `--config <projectDir>`,
  forwards stdio, and exits with the child's code. No long-lived
  connection in the Botholomew process at all.
- **Cross-process safety**: membot's lock-with-backoff means a worker
  and a `botholomew context add …` running side-by-side serialize on
  DuckDB's file lock automatically — no extra coordination on our side
  is needed.

Membot owns the DuckDB instance lifecycle: each `MembotClient` operation
claims the lock, runs, and releases between ops, with exponential
backoff on lock contention. From Botholomew's side that's invisible —
tools just call `await ctx.mem.read(...)` / `await ctx.mem.search(...)` /
etc.

Hybrid search (vector + BM25) lives in membot. The agent reaches it
through `membot_search`; see [the files doc](files.md) for the tool
surface and the [membot README](https://github.com/evantahler/membot)
for the underlying algorithm.

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
| `nuke knowledge` | Every current entry in the membot store, then prunes history (`mem.remove` + `mem.prune`). Falls back to deleting `index.duckdb` outright if the membot call fails. |
| `nuke tasks` | every `tasks/<id>.md` and any orphaned task lockfiles |
| `nuke schedules` | every `schedules/<id>.md` and any orphaned schedule lockfiles |
| `nuke threads` | every `threads/<date>/<id>.csv` (worker ticks + chat sessions) |
| `nuke all` | everything above |

Each subcommand requires `-y`/`--yes` to actually delete — running
without the flag prints counts and exits, so it doubles as a dry run.
Files under `prompts/`, skills, config, and MCPX server config are
never touched.

For safety, `nuke` refuses to run while any worker pidfile is alive —
stop them first with `botholomew worker stop <id>`.

See `src/commands/nuke.ts`.

---

## DB integrity

The knowledge-store DB is owned by membot. See the
[membot docs](https://github.com/evantahler/membot) for its
own integrity-check / repair tooling. Botholomew itself no longer ships a
`db doctor` command.

See `src/db/doctor.ts` and `src/commands/db.ts`.
