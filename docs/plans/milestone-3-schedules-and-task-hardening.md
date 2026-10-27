# Milestone 3: Schedules & Task Hardening

## Goal

Make the daemon autonomous: recurring schedules that enqueue tasks, plus robustness features for the task system (cycle detection, timeouts, full CLI).

## What Gets Unblocked

- The daemon can do recurring work without human intervention ("check my email every morning")
- Tasks can't deadlock via circular dependencies
- Stale tasks get automatically reset
- Full task management from the CLI

---

## Implementation

### 1. Schedule CRUD (`src/db/schedules.ts`)

Replace the stub with full implementation:

- `createSchedule(conn, { name, description, frequency })` — insert
- `getSchedule(conn, id)` — fetch by ID
- `listSchedules(conn, { enabled? })` — list with filters
- `updateSchedule(conn, id, updates)` — update fields
- `deleteSchedule(conn, id)` — remove
- `markScheduleRun(conn, id)` — update `last_run_at` to now

### 2. Schedule Evaluation (`src/daemon/schedules.ts`)

New module for schedule processing:

**`evaluateSchedule(config, schedule)`** — asks the LLM whether a schedule is "due" given:
- The schedule's `frequency` (plain text like "every morning", "weekly on Mondays", "every 2 hours")
- The `last_run_at` timestamp (or null if never run)
- The current date/time

Returns `{ isDue: boolean, tasksToCreate: Array<{ name, description, priority }> }`.

The LLM also determines what task(s) to create from the schedule description. For example, "check my email every morning and make a summary" produces two tasks: one for reading email, one for producing a summary (with blocked_by linking them).

**`processSchedules(conn, config)`** — called at the beginning of each daemon tick:
1. Load all enabled schedules
2. For each, call `evaluateSchedule`
3. If due, create the tasks and update `last_run_at`
4. Log to the tick's thread

### 3. Schedule Processing in Daemon Tick (`src/daemon/tick.ts`)

Update `tick()`:
1. **Process schedules first** (before claiming a task)
2. Then claim and work a task as before

### 4. Task Circular Dependency Detection (`src/db/tasks.ts`)

Add `validateBlockedBy(conn, taskId, blockedBy)`:
- Before creating or updating a task with `blocked_by`, walk the dependency graph
- If adding this edge would create a cycle, throw an error
- Algorithm: DFS from each blocker, checking if any path leads back to `taskId`

Update `createTask` to call this validation.

### 5. Task Timeout & Reset

Add to `src/daemon/tick.ts`:
- At the start of each tick, before claiming, check for tasks stuck in `in_progress`:
  - If `claimed_at` is older than `config.max_tick_duration_seconds * 3` (generous timeout), reset to `pending`
  - Clear `claimed_by` and `claimed_at`
  - Log the reset

### 6. Full Task CLI (`src/commands/task.ts`)

Add missing subcommands:

- `botholomew task update <id>` — update name, description, priority, status
- `botholomew task delete <id>` — remove a task
- `botholomew task reset <id>` — reset a stuck task back to pending

### 7. Schedule CLI (`src/commands/schedule.ts`)

New command file:

- `botholomew schedule list` — list all schedules with status
- `botholomew schedule add <name>` — create a schedule (`--frequency`, `--description`)
- `botholomew schedule view <id>` — show schedule details + recent runs
- `botholomew schedule enable <id>` / `botholomew schedule disable <id>`
- `botholomew schedule delete <id>`
- `botholomew schedule trigger <id>` — manually trigger a schedule (creates tasks immediately)

Register in `src/cli.ts`.

### 8. Daemon Agent Schedule Tools

Add to `DAEMON_TOOLS` in `src/daemon/llm.ts`:

- `create_schedule` — create a new recurring schedule
- `list_schedules` — view existing schedules

---

## Files Modified

| File | Change |
|------|--------|
| `src/db/schedules.ts` | Full CRUD implementation |
| `src/db/tasks.ts` | Add cycle detection in `createTask`, add `resetStaleTasks` |
| `src/daemon/schedules.ts` | **New** — schedule evaluation + processing |
| `src/daemon/tick.ts` | Add schedule processing + stale task reset |
| `src/daemon/llm.ts` | Add schedule tools |
| `src/commands/task.ts` | Add update, delete, reset subcommands |
| `src/commands/schedule.ts` | **New** — full schedule CLI |
| `src/cli.ts` | Register schedule command |

## Tests

- `test/db/schedules.test.ts` — schedule CRUD
- `test/db/tasks-validation.test.ts` — circular dependency detection
- `test/daemon/schedules.test.ts` — schedule evaluation (mock LLM), task creation from schedules

## Verification

1. `botholomew schedule add "Morning email" --frequency "every morning" --description "Read email and summarize"` — creates schedule
2. `botholomew daemon start --foreground` — daemon processes the schedule, creates tasks, works them
3. Create tasks with circular `blocked_by` — should error
4. Manually set a task to `in_progress` with old `claimed_at` — daemon resets it on next tick
5. `botholomew task delete <id>` and `botholomew task reset <id>` work correctly
