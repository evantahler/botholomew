# Tasks & schedules

The task queue is Botholomew's execution substrate. Humans and agents
both write to it; workers are the readers.

---

## Tasks

A task is a unit of work with a lifecycle:

```
 pending ──► in_progress ──► complete
     │            │          │ failed
     │            │          │ waiting
     │            └── (reset by timeout)
     ▼
 blocked (via blocked_by)
```

**Columns** (`src/db/sql/1-core_tables.sql`):

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT | UUIDv7 |
| `name` | TEXT | Short title |
| `description` | TEXT | Full description for the LLM |
| `priority` | ENUM | `low` / `medium` / `high` |
| `status` | ENUM | `pending` / `in_progress` / `failed` / `complete` / `waiting` |
| `waiting_reason` | TEXT | Set when the agent calls `wait_task` |
| `claimed_by` | TEXT | Worker id (`workers.id`) that claimed it |
| `claimed_at` | TEXT | ISO timestamp |
| `blocked_by` | JSON[] | Array of task IDs that must complete first |
| `context_ids` | JSON[] | Context items referenced by this task |
| `output` | TEXT | The `summary` from `complete_task` (added in migration 8) |

---

## The claim loop

`claimNextTask(conn, workerId)` in `src/db/tasks.ts`:

1. Select `pending` tasks where every `blocked_by` ID is in status
   `complete`.
2. Order by priority, then `created_at`.
3. Atomically `UPDATE ... WHERE status='pending' RETURNING *`, stamping
   the calling worker's id on `claimed_by`. If `RETURNING` comes back
   empty, another worker claimed it first — the loop tries the next
   candidate.

Multiple workers can race on the same queue safely because the atomic
UPDATE is serialized at the DuckDB instance level.

A worker holds its claimed task for the duration of the tick. Two
cleanup paths release stuck tasks:

- **Timeout**: `resetStaleTasks()` (called at the top of every tick)
  reclaims rows whose `claimed_at` is older than
  `max_tick_duration_seconds * 3` and sets them back to `pending`.
- **Dead worker**: `reapDeadWorkers()` flips any worker whose
  `last_heartbeat_at` is older than `worker_dead_after_seconds` to
  `dead` and releases every task and schedule claim held by that
  worker. See [architecture.md](architecture.md#registration-heartbeat-reaping).

A single worker can also target a specific task via
`claimSpecificTask(conn, taskId, workerId)` — used by
`botholomew worker run --task-id <id>` and the chat `spawn_worker` tool.

---

## DAG validation

`blocked_by` defines a dependency DAG. Cycles would deadlock the claim
loop, so `validateBlockedBy()` rejects them at insert time:

- DFS from each blocker, looking for a path back to the task being
  created.
- If any path exists, `createTask()` throws.

This is cheap because the graph is almost always shallow — the common
pattern is "produce N subtasks from a schedule" which is a flat
one-level fan-out.

---

## Predecessor outputs

When the agent works a task that was blocked by others, it doesn't start
from zero. `runAgentLoop()` (`src/worker/llm.ts`) fetches each blocker's
`output` (the summary passed to `complete_task`) and injects it into the
user message:

```
Task:
Name: Produce weekly summary
Description: ...
Priority: medium

Predecessor Task Outputs:
### Read email (01JE...)
- 3 urgent threads from customers about Q4 rollover...

### Check calendar (01JE...)
- 5 meetings this week, 2 with external stakeholders...
```

This is how multi-step workflows chain without a dedicated orchestrator.

---

## Schedules

A schedule is a recurring task template described in natural language:

```bash
botholomew schedule add "Morning review" \
  --frequency "every weekday at 7am" \
  --description "Read my email, check my calendar, draft a morning summary"
```

**Columns:**

| Field | Notes |
|---|---|
| `frequency` | Plain text — "every morning", "weekly on Mondays", "every 2 hours" |
| `last_run_at` | ISO timestamp of last evaluation that created tasks |
| `enabled` | Boolean |
| `claimed_by` | Worker id currently evaluating this schedule (or null) |
| `claimed_at` | ISO timestamp when the current claim was taken |

---

## LLM-evaluated "is it due?"

Instead of parsing cron expressions, `processSchedules(dbPath, config, workerId)`
(`src/worker/schedules.ts`) first **claims** each enabled schedule via an
atomic `UPDATE schedules SET claimed_by=?1 WHERE id=?2 AND (claimed_at IS
NULL OR claimed_at < stale_cutoff) AND (last_run_at IS NULL OR last_run_at
< now - min_interval) RETURNING *`. Only the worker that wins the claim
evaluates that schedule — so two concurrent workers evaluating the same
schedule never produce duplicate task batches.

Once a worker holds the claim, it asks the model:

> Given the frequency `"every weekday at 7am"`, `last_run_at`
> = 2025-04-16T07:03:12Z, and now = 2025-04-17T07:41:05Z — is this
> schedule due? If yes, what task(s) should be created?

The LLM returns structured output: `{ isDue: boolean, tasksToCreate:
Array<{ name, description, priority }> }`. If the schedule describes a
multi-step workflow ("read email and summarize"), the model can return
multiple tasks with `blocked_by` linking them — so a schedule naturally
expands into a chained DAG.

Trade-offs:

- **Flexibility.** "Every weekday at 7am, except US holidays, unless I'm
  on vacation (check calendar)" is specifiable in English and evaluable
  by the model.
- **Cost.** One (cheap) model call per enabled schedule per tick. For
  dozens of schedules this is negligible; for thousands, you'd want a
  parser.
- **Drift.** The model's idea of "morning" might not match yours.
  Tighten the frequency text if you see misfires.

`botholomew schedule trigger <id>` runs the same evaluation loop on
demand and creates the task(s) immediately — handy for verifying that
a new schedule produces the tasks you expect without waiting for the
next tick.

---

## Running the queue by hand

```bash
# Add work
botholomew task add "Draft Q4 retro" --priority high

# Inspect (newest first; supports --status, --priority, --limit, --offset)
botholomew task list --status pending
botholomew task list --limit 20 --offset 20
botholomew task view <id>

# Run a worker now (foreground, one-shot by default)
botholomew worker run
botholomew worker run --persist       # long-running tick loop
botholomew worker run --task-id <id>  # target a specific task

# Unstick a task
botholomew task reset <id>
botholomew task delete <id>

# Manually fire a schedule
botholomew schedule trigger <id>
```

All of the same operations are available to the chat agent (`create_task`,
`list_tasks`, `view_task`, `update_task`, `create_schedule`,
`list_schedules`) so you can drive the queue conversationally too.
