# Milestone 9: Worker Agents

## Goal

Replace the single OS-managed daemon with multiple in-DB-registered
**workers**. Users dispatch workers manually (CLI), from chat (via a tool),
or via cron — no more installed background service, no more launchd plist
or systemd unit. Workers self-register, heartbeat, and are reaped if they
stop checking in.

## What Gets Unblocked

- Users can run many workers at once on the same project (including burst
  fan-out for backlogs).
- The chat agent can dispatch work via the `spawn_worker` tool ("run this
  task now").
- Scheduled execution is handed back to the user: plain cron, a tmux
  pane, or an optional launchd/systemd template — whichever they prefer.
- Crashed workers are detected and their tasks reclaimed automatically.

## Implementation

### 1. `workers` table + schedule claim columns (`src/db/sql/12-workers.sql`)

- New `workers` table: `id` (uuidv7), `pid`, `hostname`, `mode`
  (`persist` / `once`), `task_id` (for pinned one-shot), `status`
  (`running` / `stopped` / `dead`), `started_at`, `last_heartbeat_at`,
  `stopped_at`.
- Index on `(status, last_heartbeat_at)` for fast reaper scans.
- Added `claimed_by` / `claimed_at` to `schedules` so only one worker
  evaluates a schedule per window.
- Rewrote `threads.type` values from `daemon_tick` to `worker_tick` by
  rebuilding `threads` + `interactions` (interactions' FK to threads had
  to go, following the `7-drop_embeddings_fk.sql` precedent).

### 2. CRUD in `src/db/workers.ts`

`registerWorker`, `heartbeat`, `markWorkerStopped`, `markWorkerDead`,
`reapDeadWorkers`, `listWorkers`, `getWorker`. `reapDeadWorkers` runs a
transaction: flip stale `running` rows to `dead`, then release every
task and schedule claim those workers held.

### 3. Atomic claims

- `claimNextTask(conn, workerId)` — existing atomic UPDATE, now
  always parameterised by the calling worker's id.
- `claimSpecificTask(conn, taskId, workerId)` — new helper for
  `--task-id` mode and the chat tool.
- `claimSchedule(conn, scheduleId, workerId, opts)` — new atomic claim
  gated by `staleAfterSeconds` and `minIntervalSeconds`.
- `releaseSchedule(conn, scheduleId, workerId)` — clears own claim only.

### 4. Non-blocking heartbeat + reaper (`src/worker/heartbeat.ts`)

`setInterval`-driven; unref'd so it doesn't keep the event loop alive on
its own. Errors swallowed with a warning (a transient DB lock shouldn't
crash a working worker). `startHeartbeat` runs for every worker;
`startReaper` only for persist workers.

### 5. Tick + modes (`src/worker/index.ts`, `src/worker/tick.ts`)

- `startWorker(projectDir, { foreground, mode, taskId, evalSchedules })`.
- Default mode: `once`. Claims one task (specific if `taskId`, else next
  eligible), runs it, marks the worker stopped, exits.
- `persist` mode: classic tick loop, heartbeat + reaper intervals,
  sleeps `tick_interval_seconds` when idle.
- `tick(opts)` and `runSpecificTask(opts)` accept `workerId`, pass it
  into `claimNextTask` / `claimSpecificTask` / `processSchedules`.

### 6. CLI (`src/commands/worker.ts`)

```
botholomew worker run [--persist] [--task-id <id>] [--no-eval-schedules]
botholomew worker start [--persist] [--task-id <id>]
botholomew worker list [--status <running|stopped|dead>] [--limit] [--offset]
botholomew worker status <id>
botholomew worker stop <id>      # SIGTERM + mark stopped
botholomew worker kill <id>      # SIGKILL + mark dead
botholomew worker reap
```

No backward-compat alias for `botholomew daemon`.

### 7. TUI (`src/tui/components/WorkerPanel.tsx`)

New tab 7 ("Workers"). Help moves to tab 8. Panel lists workers with
status filter (`f` cycles), shows pid, mode, heartbeat age. Detail pane
has full id, hostname, started/stopped/heartbeat timestamps, pinned task.
Polls the DB every ~3s.

`StatusBar` and `HelpPanel` now read the `workers` table instead of a
PID file.

### 8. Chat tool (`src/tools/worker/spawn.ts`)

`spawn_worker({ task_id?, persist? })` — wraps `spawnWorker`. Returns
`{ worker_pid, mode, message }`. Added to the chat tool allowlist.

### 9. Config (`src/config/schemas.ts`)

New keys:
- `worker_heartbeat_interval_seconds` (default 15)
- `worker_dead_after_seconds` (default 60)
- `worker_reap_interval_seconds` (default 30)
- `schedule_min_interval_seconds` (default 60)
- `schedule_claim_stale_seconds` (default 300)

### 10. Migration loader fix (`src/db/schema.ts`)

Sort migrations by numeric id, not filename. Without this, `12-*.sql`
would run between `11-*.sql` and `2-*.sql` — latent bug, no prior
migration touched tables from migration 2 so it never mattered.

## Files Modified

| File | Change |
|------|--------|
| `src/db/sql/12-workers.sql` | **New** migration |
| `src/db/workers.ts` | **New** CRUD module |
| `src/db/schema.ts` | Sort migrations numerically |
| `src/db/tasks.ts` | `claimNextTask` drops `"daemon"` default; adds `claimSpecificTask` |
| `src/db/schedules.ts` | Adds `claimed_by`/`claimed_at` fields; `claimSchedule` + `releaseSchedule` |
| `src/db/threads.ts` | `type` literal: `daemon_tick` → `worker_tick` |
| `src/worker/index.ts` | Rewritten for registration + modes + heartbeat lifecycle |
| `src/worker/heartbeat.ts` | **New** — setInterval-based heartbeat + reaper |
| `src/worker/tick.ts` | Accepts `{ opts }` object; `runSpecificTask` helper |
| `src/worker/schedules.ts` | Uses `claimSchedule` + `releaseSchedule` |
| `src/worker/spawn.ts` | Drops PID gate; accepts mode + taskId |
| `src/worker/run.ts` | Parses `--persist`, `--task-id=`, `--no-eval-schedules` |
| `src/commands/worker.ts` | **New** CLI (replaces `src/commands/daemon.ts`) |
| `src/commands/chat.ts` | Dropped `--no-daemon` auto-spawn path |
| `src/commands/nuke.ts` | Guard replaced: now refuses when any worker is running |
| `src/cli.ts` | Registers `worker`, unregisters `daemon` |
| `src/constants.ts` | Drops watchdog + PID constants; `LOG_FILENAME = "worker.log"` |
| `src/tui/components/WorkerPanel.tsx` | **New** panel |
| `src/tui/components/TabBar.tsx` | 8 tabs now |
| `src/tui/components/StatusBar.tsx` | Reads `workers` table |
| `src/tui/components/HelpPanel.tsx` | "Daemon" → "Workers" |
| `src/tui/components/ThreadPanel.tsx` | Labels: daemon_tick → worker |
| `src/tui/App.tsx` | Tab 7 is Workers, tab 8 is Help |
| `src/tools/worker/spawn.ts` | **New** `spawn_worker` tool |
| `src/tools/registry.ts` | Registers `spawn_worker` |
| `src/chat/agent.ts` | Allows `spawn_worker` in chat tool set |
| `src/config/schemas.ts` | Five new config keys |
| `docs/architecture.md` | Rewrite: three-process model, registration/heartbeat/reaping |
| `docs/automation.md` | **New** — cron, tmux, launchd, systemd samples |
| `docs/tasks-and-schedules.md` | Updated claim semantics, worker id in `claimed_by` |
| `docs/configuration.md` | New config keys |
| `docs/tui.md` | Eight tabs, Workers panel |
| `README.md` | Worker CLI row; three-process diagram |
| `CLAUDE.md` | Directory rename + doc references |

### Files removed

- `src/daemon/watchdog.ts`
- `src/daemon/healthcheck.ts`
- `src/daemon/ensure-running.ts`
- `src/utils/project-registry.ts`
- `src/utils/pid.ts`
- `src/commands/daemon.ts`
- `test/daemon/watchdog.test.ts`
- `test/daemon/healthcheck.test.ts`
- `test/utils/pid.test.ts`
- `test/utils/project-registry.test.ts`
- `docs/watchdog.md`

(`src/daemon/` is now `src/worker/`.)

## Tests

| File | Covers |
|------|--------|
| `test/db/workers.test.ts` | Register, heartbeat, mark stopped/dead, reap (tasks released, schedule claims cleared) |
| `test/db/schedules-claim.test.ts` | Atomic claim, concurrent-claim exclusion, min-interval + stale-claim windows, release |
| `test/db/tasks-claim-specific.test.ts` | `claimSpecificTask` atomic claim; null for claimed / non-pending / missing |
| `test/worker/heartbeat.test.ts` | `setInterval` heartbeat advances `last_heartbeat_at`; reaper flips stale workers |
| `test/worker/tick.test.ts` | Updated for new `tick(opts)` object signature |
| `test/worker/schedules.test.ts` | Updated for `processSchedules(dbPath, config, workerId)` |
| `test/db/tasks*.test.ts` | Updated for required `claimedBy` arg |
| `test/commands/nuke.test.ts` | Updated to assert "worker(s) running" refuse path |
| `test/db/schema.test.ts` | Migration count is 12 |

## Verification

1. `bun run lint` — clean.
2. `bun test` — 649 tests pass.
3. Manual smoke:
   - `bun run dev worker run` → claims one task or exits "no eligible task"; row shows `status=stopped`.
   - `bun run dev worker run --persist` → heartbeats every ~15s until Ctrl+C.
   - `bun run dev worker start --persist` twice → two rows, both running.
   - `kill -9` one of them → reaper flips its row to `dead` within ~90s and releases its task.
   - Chat: have the LLM call `spawn_worker` → new row appears in the Workers tab.
   - No `~/Library/LaunchAgents/com.botholomew.*.plist` or
     `~/.config/systemd/user/botholomew-*.*` files are written.
4. `package.json` version bumped.

## Status: **In Progress**
