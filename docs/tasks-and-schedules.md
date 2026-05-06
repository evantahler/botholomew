# Tasks & schedules

The task queue is Botholomew's execution substrate. Humans and agents
both write to it; workers are the readers. Each task and each schedule
is a markdown file you can `vim`, `grep`, `git diff`, and edit by
hand.

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

Tasks live as `tasks/<id>.md` files (id is uuidv7). Status, priority,
dependencies, and output are stored in YAML frontmatter; the body is
the human/LLM-readable description:

```markdown
---
id: 0193abcd-7c10-7d8a-...
name: Summarize PR #42
priority: medium
status: pending          # pending | in_progress | complete | failed | waiting
blocked_by: []           # task ids that must reach status: complete first
context_paths: []        # files under context/ this task should reference
output: null             # filled on completion (summary string from complete_task)
waiting_reason: null
created_at: 2026-05-02T10:00:00Z
updated_at: 2026-05-02T10:00:00Z
---

# Description

The free-form body the LLM sees. Markdown all the way down.
```

Frontmatter is strictly validated by Zod (`src/tasks/schema.ts`).
Files that fail validation are quarantined — workers skip them and the
DAG checker ignores them. `botholomew tasks doctor` lists malformed files
so you can fix them in place.

---

## The claim loop

Tasks are claimed by lockfile, not by a DB row update.
`claimNextTask(projectDir, workerId)` in `src/tasks/claim.ts`:

1. Walk `tasks/` and parse the frontmatter of each `.md` file.
2. Filter to status `pending` where every `blocked_by` id has status
   `complete` on disk.
3. Order by priority, then `created_at`.
4. For each candidate, try
   `open(O_CREAT|O_EXCL|O_WRONLY)` on
   `tasks/.locks/<id>.lock`. The lockfile body holds the worker id and
   `claimed_at`. The first worker wins; the rest get `EEXIST` and try
   the next candidate.
5. On claim, atomic-write the canonical `<id>.md` with `status:
   in_progress` (mtime check; abort and retry if the file changed
   underneath).

Multiple workers can race on the same queue safely because the kernel
serializes `O_EXCL`. Two cleanup paths release stuck claims:

- **Timeout**: `resetStaleTasks()` (called at the top of every tick)
  walks the lockfiles, reads each one's `claimed_at`, and unlinks any
  whose age exceeds `max_tick_duration_seconds * 3` — the matching
  task file is rewritten to `status: pending`.
- **Dead worker**: `reapDeadWorkers()` walks `tasks/.locks/` and
  `schedules/.locks/`, looks up each lockfile's worker id in
  `workers/`, and unlinks the lock if the owner is dead or missing.
  See [architecture.md](architecture.md#registration-heartbeat-reaping).

A single worker can also target a specific task via
`botholomew worker run --task-id <id>` and the chat `spawn_worker`
tool.

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

Schedules live as `schedules/<id>.md` files with the same frontmatter
+ body shape as tasks:

```yaml
---
id: ...
name: Morning review
description: Read my email, check my calendar, draft a morning summary
frequency: every weekday at 7am   # human-friendly; LLM evaluator decides if due
last_run_at: 2026-05-02T07:03:00Z
enabled: true
created_at: ...
updated_at: ...
---
```

---

## LLM-evaluated "is it due?"

Instead of parsing cron expressions, `processSchedules(projectDir,
config, workerId)` (`src/worker/schedules.ts`) walks
`schedules/<id>.md`, filters to `enabled: true` and a
`schedule_min_interval_seconds` window past `last_run_at`, and tries
`O_EXCL` on `schedules/.locks/<id>.lock` for each. Only the worker
that wins the claim evaluates that schedule — so two concurrent
workers evaluating the same schedule never produce duplicate task
batches.

Once a worker holds the claim, it asks the model:

> Given the frequency `"every weekday at 7am"`, `last_run_at`
> = 2025-04-16T07:03:12Z, and now = 2025-04-17T07:41:05Z — is this
> schedule due? If yes, what task(s) should be created?

The LLM returns structured output: `{ isDue: boolean, tasksToCreate:
Array<{ name, description, priority }> }`. If `isDue` is true, the
worker writes new `tasks/<id>.md` files for each entry, then
atomic-writes the schedule's own `<id>.md` back with an updated
`last_run_at` (mtime check; if you edited the schedule in vim
mid-evaluation the worker aborts and retries next tick). Finally it
unlinks the lockfile.

If the schedule describes a multi-step workflow ("read email and
summarize"), the model can return multiple tasks with `blocked_by`
linking them — so a schedule naturally expands into a chained DAG.

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
`list_tasks`, `view_task`, `update_task`, `delete_task`, `create_schedule`,
`list_schedules`) so you can drive the queue conversationally too.
`delete_task` refuses tasks in `in_progress` — the worker has no
mid-execution interrupt, so wait for it to finish or run
`botholomew task reset <id>` from the CLI first.
