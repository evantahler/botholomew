# Phase 14 — Schedules and wakeups

> **Goal:** A person, or a bot, can say "every weekday at 7am, review my inbox and draft a summary". The
> phrase is compiled once into a cron expression and timezone that a person confirms. From then on, each
> due firing hands the schedule to its bot exactly once, and the bot turns it into tasks. Bots can also set
> durable reminders for themselves and for people, and outside systems can wake a bot through its own
> webhook URL.

> **Status: planned, not built.** Stage D — Swarms. Depends on [phase 5](./phase-05-bots.md),
> [phase 6](./phase-06-durable-bot-loop.md), [phase 7](./phase-07-threads-and-web-chat.md),
> [phase 8](./phase-08-context-management.md), and [phase 13](./phase-13-leader-and-workers.md).

Always-on bots need a clock. Until now a bot only wakes when someone writes to it. This phase gives it three
more reasons to wake: a schedule fires, a reminder comes due, or an external system calls its webhook. All
three land in the same place every other wake lands — an `event` row in a conversation's inbox. The loop
from [phase 6](./phase-06-durable-bot-loop.md) does not change. Only the producers of rows are new.

Schedules come from v1. A v1 schedule ([src/schedules/schema.ts](https://github.com/evantahler/botholomew/blob/v1/src/schedules/schema.ts))
has a name, a description of what to do, a natural-language `frequency`, `enabled`, a model pin, and
`last_run_at`. When it is due, the worker turns it into tasks, using `depends_on` to chain the steps
([src/worker/schedules.ts](https://github.com/evantahler/botholomew/blob/v1/src/worker/schedules.ts)). Three
parts of that design were right, and they stay:

- **Plain-language authoring.** People describe a schedule in their own words.
- **A schedule expands into a task graph.** In v1's words, a schedule "naturally expands into a chained DAG".
- **Bots create schedules themselves** with `create_schedule`.

The "when" was wrong. v1 asked the fast model "is this due?" once per enabled schedule on every worker tick,
and the default tick was 300 seconds — so each schedule cost about 288 model calls a day before doing any
work. The v1 docs admit as much: "for thousands, you'd want a parser". The answer was nondeterministic too
("The model's idea of 'morning' might not match yours"). A failed evaluation silently counted as "not due".
And nothing recorded when a schedule fired, or why.

2.0 keeps the authoring and the expansion, and replaces the when:

- **The phrase is compiled once.** The fast model turns it into cron plus an IANA timezone at creation time,
  and a person confirms the result.
- **Firing reuses ToolExec's proven guards.** The scheduler is the one `toolexec:docs/plans/phase-09-cron-runs.md`
  built and `toolexec:docs/plans/phase-19-workflows.md` moved onto workflows: three idempotence guards, a
  one-run catch-up, and correct DST handling.
- **The product rules come from Grok Bot.** Its [schedule docs](https://docs.x.ai/grok-bot/skills-routines-and-automations)
  set them: "at least five minutes apart", up to 50 per bot, the 20 most recent run records, test runs that
  "perform real work", and asking "whether to keep routines running after a long period away", then pausing
  "if there is no response".

This phase deliberately leaves out triggers from integration events, such as a Slack message
([phase 16](./phase-16-slack.md)); a per-bot webhook URL covers the generic case. It also leaves out holiday
and calendar awareness inside the scheduler. Conditions like "except US holidays" become instructions the bot
checks when the schedule fires.

## Scope

**In:** `schedules` and `schedule_runs`; natural-language frequency compiled once by the project's fast
model, previewed, and confirmed by a person; `CronOps`, ported with a minimum-gap scan for the 5-minute
floor; `schedules:fire`, with ToolExec's three idempotence guards, one-run catch-up, and DST correctness;
each firing as a root task placed in the schedule's thread ([phase 13](./phase-13-leader-and-workers.md));
run records (the last 20), a test run, enable and disable, auto-pause after repeated failures, auto-pause
after a long owner absence with a keep-alive prompt; the `schedule_create` / `schedule_list` / `schedule_edit`
bot tools; `bot_wakeups`, which makes `sleep_until` and a new `remind_me` durable rows behind
`conversations.wakeAt`; per-bot webhook URLs with ToolExec's ingress discipline; an optional reflection
schedule, off by default; the UI, `botholomew schedule …`, `reminder …`, and `bot webhook …`; user docs.

**Out:** Slack and iMessage triggers ([phase 16](./phase-16-slack.md), [phase 17](./phase-17-imessage.md)).
Provider-specific webhook signatures such as GitHub's `X-Hub-Signature-256`: the token in the path is the
secret, as in ToolExec, and HMAC verification plugs in later. Email notifications for keep-alive prompts: the
2.0 shell drops the mail transport ([phase 1](./phase-01-clean-slate-and-shell.md)). Retention of tasks and
threads that schedules create ([phase 18](./phase-18-operations.md)).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| v1 schedules | The model to port: name, description, `frequency`, `enabled`, `model`, `last_run_at`; a claim lock; a `schedule_min_interval_seconds` gate | [src/schedules/schema.ts](https://github.com/evantahler/botholomew/blob/v1/src/schedules/schema.ts), [src/schedules/store.ts](https://github.com/evantahler/botholomew/blob/v1/src/schedules/store.ts) |
| v1 evaluation | The per-tick model call being replaced, and the expansion into tasks with `depends_on` that is kept | [src/worker/schedules.ts](https://github.com/evantahler/botholomew/blob/v1/src/worker/schedules.ts), [docs/tasks-and-schedules.md](https://github.com/evantahler/botholomew/blob/v1/docs/tasks-and-schedules.md) |
| v1 schedule tools and CLI | `create_schedule`, `schedule_edit`, `list_schedules`; `schedule add/list/view/enable/disable/delete/trigger` | [src/tools/schedule/](https://github.com/evantahler/botholomew/tree/v1/src/tools/schedule), [src/commands/schedule.ts](https://github.com/evantahler/botholomew/blob/v1/src/commands/schedule.ts) |
| v1 reflection | The dream instructions, and the field note that they "fixate on themes rather than facts" | [src/chat/dream-prompt.ts](https://github.com/evantahler/botholomew/blob/v1/src/chat/dream-prompt.ts), [docs/field-notes.md](https://github.com/evantahler/botholomew/blob/v1/docs/field-notes.md) |
| v1 `sleep` | An in-process sleep capped at an hour, whose description says "For longer pauses, create a schedule instead" — the gap durable wakeups close | [src/tools/util/sleep.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/util/sleep.ts) |
| ToolExec cron | `validateCron`, `nextFireTimes`, `fireTimesBetween`, `lastFireTimeAtOrBefore`, `describeCron`, `CATCHUP_SCAN_LIMIT`; the only importer of `cron-parser` | `toolexec:backend/ops/CronOps.ts` |
| ToolExec scheduler | `FOR UPDATE SKIP LOCKED`, the conditional `lastEnqueuedAt` advance with `IS NOT DISTINCT FROM`, the partial unique index backstop, a unique violation logged at `debug` | `toolexec:backend/actions/workflow/workflows-schedule.ts`, `toolexec:backend/actions/workflow/workflow-schedule-preview.ts` |
| ToolExec webhook ingress | Raw body, token read from the path, a frozen byte-identical 404, per-token `checkRateLimit`, a body cap enforced while reading, a pending cap, a header allowlist, rotation under a row lock, `deliveryKey` dedupe | `toolexec:backend/actions/webhook/webhook-trigger.ts`, `toolexec:backend/actions/webhook/session-event.ts`, `toolexec:backend/ops/WebhookOps.ts`, `toolexec:backend/ops/RawRequestOps.ts`, `toolexec:backend/schema/agent_run_messages.ts` |
| ToolExec editor panels | A schedule panel with a live "next 5" preview; a webhook panel with a one-time reveal | `toolexec:frontend/src/components/SchedulePanel.tsx`, `toolexec:frontend/src/components/WebhookPanel.tsx` |
| The loop's wake | `conversations.wakeAt`, which `bots:dispatch` claims when due; `sleep_until`; `event` inbox rows; `requestId` exactly-once; event priority with aging | [phase 6](./phase-06-durable-bot-loop.md) |
| Tasks | `createTask` with a root task placed in an existing thread, `settleTask`, model pins inherited by children, `bots:workforce-check` | [phase 13](./phase-13-leader-and-workers.md) |
| Episodic recall | `thread_search` and `thread_read`, which the reflection schedule needs | [phase 8](./phase-08-context-management.md) |

## What this must not weaken

1. **The row is the delivery.** A firing, a reminder, and a webhook delivery each become an `event` inbox row
   in the same transaction that records them. A Resque job is only an accelerant.
2. **A clock fires at most once per fire time.** Two workers racing the same minute produce one run, and the
   database is the backstop, not the application.
3. **Nothing arms an unattended trigger without a person.** Confirming a schedule, enabling one, keeping one
   alive, and rotating a webhook URL are human actions. They are audited, and they are never MCP tools. A bot
   may propose, disable, and edit a schedule. It may not arm one.
4. **Machine ingress writes no audit rows and carries no authority.** A webhook body is fenced, untrusted
   data, and an event can never steer a running turn.
5. **No existence oracle.** An unknown token, a disabled hook, a disabled bot, and a rotated-away token all
   return the same bytes.
6. **Postgres first, then the model.** The compile call is made before anything is saved, and its output is
   validated deterministically. A firing never calls a model to decide whether it is due.

## Design

### Schedules are rows, not memory files

v1 kept schedules as `schedules/<id>.md`. 2.0 moves prompts and skills into project memory, because those
are authored text that gains from versioning, diff, and search. A schedule is mostly runtime state:

- **The clock writes it.** `lastEnqueuedAt` changes on every firing, and pause flags, failure counts, and
  keep-alive deadlines change underneath it.
- **It needs locks and indexes.** The scheduler claims it under a row lock, finds it through a partial index,
  and guards it with a unique index.

As a memory file, a schedule that fires every five minutes would mint 288 versions a day, and none of it could
be locked or indexed. The authored part, the description, is short. Its history lives in the audit log, which
records the old and new text and the `describeCron` sentence on every edit.

### A schedule is a when, a what, and an owner

- **When:** `cronExpression` plus `cronTimezone`, compiled from `frequencyText` (kept as the author wrote it),
  with `residualConditions` for anything cron cannot say.
- **What:** `description` — the instructions handed to the bot — and an optional model pin, which the tasks
  inherit, as in v1.
- **Who:** `botId`, the owning bot (the leader by default), and `ownerUserId`, the person who answers for it.
  That is whoever confirmed it last.
- **Where:** a dedicated thread created with the schedule (kind `chat`, origin `schedule`, owned by the bot,
  titled with the schedule's name), or an existing thread the bot already owns. Output lands in one place a
  person can read, and the bot's conversation in that thread carries what it did last time.

A schedule fires only when `enabled`, `confirmedAt`, and `pausedAt` all allow it: enabled, confirmed, and not
paused. `enabled` is the human switch. `pausedAt` with a `pauseReason` (`owner_absent`, `repeated_failures`,
`owner_lost_access`) is the system's switch, and the UI shows the two differently. Deleting a bot deletes its
schedules, as Grok Bot does.

### Compile once, confirm once

`compileFrequency(text, { timezone, now })` runs at creation and whenever the frequency text changes.

**The fast path.** If the text already parses as a cron expression, it is used as is, with no model call.

**Otherwise, the fast model.** The project's fast model is resolved at the boundary
([phase 5](./phase-05-bots.md)), and it returns structured output:

```
{ cronExpression, timezone, summary, residualConditions, ambiguities[] }
```

`timezone` comes from the text ("7am Pacific") or falls back to the caller's timezone (the browser's or the
CLI's `Intl`), then to `project_settings.defaultTimezone`. The model also sees today's date, so "every other
Monday" can be anchored.

**Deterministic validation.** `validateCron` then checks the result. It returns `describeCron`'s sentence,
the next five fire times, and the smallest gap between fire times. Model output that fails validation is
returned as problems, never saved.

**Confirmation.** The person sees "every weekday at 07:00 America/New_York — Mon 6 Oct 07:00, Tue 7 Oct 07:00,
…", plus the conditions the bot will check ("skip US federal holidays"), and confirms.

**Why residual conditions exist.** This is how 2.0 keeps v1's best argument for natural language ("Every
weekday at 7am, except US holidays, unless I'm on vacation") without a model call per tick. Cron decides
*when to look*; the bot decides *whether there is anything to do*. When a condition holds, the bot closes the
run with `task_complete` and an output like "skipped: Labor Day".

`schedule:confirm` takes back the exact expression and timezone the person saw. If the stored proposal has
changed since, it answers 409, so nobody confirms something they did not read. Confirming sets `ownerUserId`
to the confirmer and resets the anchor to now, so a fresh schedule never catches up on fire times from before
it existed. If no fast model is connected, compiling refuses with a hint to enter cron directly.

A schedule a bot creates starts unconfirmed while `project_settings.botSchedulesNeedConfirmation` is on, which
is the default. The tool posts a confirmation card in the thread it was created from. Usually a person just
asked for the schedule, so the card arrives while they are looking.

### Firing, exactly once

`schedules:fire` runs every 60 s on the `orchestrator` queue:

```
for each schedule that is enabled, confirmed, and not paused (partial index), FOR UPDATE SKIP LOCKED:
  due = fireTimesBetween(expr, tz, lastEnqueuedAt, now)          capped by CATCHUP_SCAN_LIMIT
  if due is empty                                       → continue
  if the latest run's root task is still open           → continue, without advancing (in-flight guard)
  firedFor = lastFireTimeAtOrBefore(now)                exact after any outage
  if firedFor - previous run's firedFor < 5 min         → record a skipped run (spacing) and advance
  UPDATE schedules SET lastEnqueuedAt = firedFor
    WHERE id = $id AND lastEnqueuedAt IS NOT DISTINCT FROM $expected       (guard 2)
  INSERT schedule_runs (firedFor, missedFirings = due.length - 1)          (guard 3: unique index)
  createTask(tx, placed in schedule.threadId, assignee = schedule.botId,
             requestId = schedule-run:<runId>, modelName = schedule.modelName)
  delete runs beyond the newest 20 for this schedule
```

`lastEnqueuedAt` is the fire time enqueued *for*, never the wall clock. ToolExec learned that stamping
`now()` compounds lateness once per firing.

**Catch-up.** After an outage, a schedule fires once and records `missedFirings`, so a recovering worker does
not stampede.

**Overlap.** A schedule whose previous run is still open waits rather than piling up. It fires once that run
settles, and the workforce check reports a run that has stayed open longer than the schedule's interval.

**Edits.** Changing the expression resets the anchor only when the expression actually changed, so pressing
Save at 06:59 never cancels the 07:00 run.

**The 5-minute floor is checked twice.** ToolExec's `validateCron` compares only the next two fire times.
`*/7 * * * *` passes that test (07:00 then 07:07) but fires at :56 and again at :00, four minutes apart. 2.0's
validator scans the minimum gap across the next 1,000 fire times or eight days, whichever comes first. That
also catches the DST fold, where a wall-clock hour repeats. The fire-time spacing check backs it up: whatever
the expression says, two runs are never under five minutes apart.

### What a firing hands the bot

The root task is placed in the schedule's thread, so its brief arrives as a `task.assigned` event
([phase 13](./phase-13-leader-and-workers.md)). The event carries the schedule's name and id, the run id,
`firedFor` in the schedule's timezone, `missedFirings`, the description, and the residual conditions. It ends
with the instruction to do the work directly or split it with `delegate`, chaining steps with `blocked_by`.
That is v1's "a schedule naturally expands into a chained DAG", now a decision the bot makes when the schedule
fires instead of a model guess on every tick. The root task gets the swarm's guards, reports, and canvas for
free.

`settleTask` updates the run's status when its root task settles. Three consecutive failed runs pause the
schedule (`repeated_failures`) and notify the owner.

### Auto-pause when the owner is away

`users.lastSeenAt` is bumped at most once every ten minutes by session middleware. The hourly
`schedules:absence-check` handles two cases:

- **The owner has been away.** When a confirmed schedule's owner has not been seen for `absenceDays` (14),
  the check posts a keep-alive card in the schedule's thread and notifies the owner. Anyone with write access
  to the bot may answer **Keep running** (`schedule:keep-alive`), and becomes the owner by doing so. If nobody
  answers within `absenceGraceDays` (3), the schedule pauses with reason `owner_absent`.
- **The owner has lost access.** An owner who no longer has write access to the bot pauses the schedule at
  once (`owner_lost_access`). A schedule must never keep acting in the name of someone who has left.

The next time the owner signs in, a banner lists the schedules paused while they were away. Grok Bot says to
"review paused routines when you return". Nothing unpauses on its own.

### Wakeups: `sleep_until` and `remind_me`

[Phase 6](./phase-06-durable-bot-loop.md) gives each conversation one `wakeAt`, which `sleep_until` sets.
That single column cannot hold "continue this at 14:00" and "remind me Friday about the invoice" at the same
time. This phase adds `bot_wakeups` rows (`kind: sleep | reminder`), and `wakeAt` becomes their cache. Every
write that adds, delivers, or cancels a wakeup recomputes `wakeAt` as the earliest pending one, as does lease
release. `bots:dispatch` is unchanged: it still claims a conversation whose `wakeAt` is due. The tick's first
fenced step then turns that conversation's due wakeups into `event` inbox rows, with `requestId`
`wakeup:<id>`, and marks them delivered. A crash between the claim and the tick therefore delivers each
reminder exactly once.

- **`remind_me`** takes `{ at | in, note, thread? }` and creates a reminder. With `thread` set, it targets
  that thread's conversation instead of the current one. Reminders serve people as well: "remind me Friday to
  send the report" becomes the bot's turn on Friday, which posts in the thread.
- **Limits.** A reminder must be at least a minute ahead and at most a year away, and each bot may hold at
  most 100 pending.
- **Reminders are not tasks.** They carry a note, not a status. Work that must finish belongs in
  `task_wait` ([phase 13](./phase-13-leader-and-workers.md)).

### A webhook URL per bot

`PUT /api/webhook/bot/:token` (`webhook:bot-event`) is 2.0's first unauthenticated write surface; the signed
Slack and Linq ingress come later ([phase 16](./phase-16-slack.md), [phase 17](./phase-17-imessage.md)). It
ports ToolExec's discipline as it stands after that project's learnings:

- **Raw body.** `web.rawBody: true`. The token is read from the request path, never from `params`, because a
  body containing `{"token": "…"}` must not redirect a delivery to another hook.
- **Hashed tokens.** Only `sha256(token)` is stored, behind a partial unique index, so one indexed equality
  does the lookup. That is why no `timingSafeEqual` is needed, and the code comment says so.
- **No existence oracle.** An unknown token, a disabled hook, a disabled or deleted bot, and a rotated token
  all get one frozen 404 body with no timestamp.
- **Limits.** A per-token `checkRateLimit` keyed on the hash returns 429 with `Retry-After`. A body cap
  (256 KB) is enforced while reading and returns 413. A pending cap of 20 undelivered events per hook,
  re-taken under `FOR UPDATE` on the hook row, returns 429.
- **Deduplication.** A delivery key is required: `X-GitHub-Delivery`, `Linear-Delivery`, or
  `X-Botholomew-Delivery`. Without one the answer is 422, which is specific because the caller holds a valid
  token. The key becomes the inbox row's `requestId` (`webhook:<hookId>:<key>`), so a retried delivery answers
  202 `{ duplicate: true }` and writes nothing.
- **What is stored.** An allowlist of headers is stored, never `authorization` or cookies, along with the raw
  body.
- **How the bot sees it.** The delivery is an `event` row (`webhook.received`) in the hook's target thread,
  with the hook's standing instructions. It is `follow_up` only, so it can never steer a running turn. It is
  fenced as untrusted data.
- **No audit rows.** An unauthenticated caller must not be able to append to the audit table.

A bot may have up to 10 named hooks — "github", "ci" — each with its own thread. That way, unrelated event
streams do not share one conversation's context. Creating, rotating, and disabling a hook is one audited,
never-MCP action, `bot-webhook:rotate`, which returns the plaintext once. Bots get no webhook tools, because
arming an ingress is a human act.

### The reflection schedule, off by default

A project can add one schedule of `kind = reflection` per bot from a template. It is created disabled, it runs
daily at 03:00 in the project's timezone, and the person who enables it confirms the time.

The instructions are a built-in constant, ported from [src/chat/dream-prompt.ts](https://github.com/evantahler/botholomew/blob/v1/src/chat/dream-prompt.ts).
They are rendered at fire time rather than stored, so improvements reach every project, and a person can add
extra instructions on top. The rewrite answers the v1 field note — "it fixates on *themes* rather than facts …
Facts beat vibes":

- **Recall.** Use `thread_search` and `thread_read` over the bot's threads since its last reflection.
- **Write facts.** Each one is a single dated line naming the thread it came from, written at its natural path
  in memory or under `bots/<slug>/notes/facts/`. There is no diary of reflections.
- **Edit prompts sparingly.** Only `agent-modification: true` prompts may change, and the edits stay small.
- **Report** the paths written.

The run's output is that list. A reflection that writes no facts completes with "nothing new".

## Steps

### 1. Schema — `backend/schema/{schedules,schedule_runs,bot_wakeups,bot_webhooks}.ts`

`schedules`:

| Column | Type | Notes |
|---|---|---|
| `projectId` | int | → `projects`, cascade |
| `botId` | int | → `bots`, cascade |
| `threadId` | int, null | → `threads`, set null. Recreated lazily |
| `name` | text | Unique `(botId, name)` |
| `description` | text | The instructions |
| `kind` | text | `standard \| reflection` |
| `frequencyText` | text | As written |
| `cronExpression` / `cronTimezone` | text | Validated, normalized whitespace |
| `residualConditions` | text, null | |
| `modelName` | text, null | Pin, inherited by tasks |
| `enabled` | boolean | Default `false` until confirmed |
| `confirmedAt` / `confirmedByUserId` | timestamptz / int, null | |
| `ownerUserId` | int, null | → `users`, set null |
| `pausedAt` / `pauseReason` | timestamptz / text, null | |
| `lastEnqueuedAt` | timestamptz, null | The fire time enqueued for |
| `consecutiveFailures` | int | Default 0 |
| `keepAlivePromptedAt` / `keepAliveDeadlineAt` | timestamptz, null | |
| `createdByUserId` / `createdByBotId` | int, null | |
| `createdAt` / `updatedAt` | timestamptz | |

There is a partial index on `(id) WHERE enabled AND confirmed_at IS NOT NULL AND paused_at IS NULL`, and a
per-bot count check of at most 50 in `createSchedule`.

`schedule_runs`:

| Column | Type | Notes |
|---|---|---|
| `projectId` | int | Cascade |
| `scheduleId` | int | Cascade |
| `firedFor` | timestamptz | |
| `status` | text | `running \| succeeded \| failed \| cancelled \| skipped` |
| `skipReason` | text, null | |
| `missedFirings` | int | |
| `taskId` | int, null | → `bot_tasks`, set null |
| `isTest` | boolean | |
| `triggeredByUserId` | int, null | Test runs |
| `createdAt` / `finishedAt` | timestamptz | |

The guard-3 backstop is `CREATE UNIQUE INDEX schedule_runs_one_per_fire_idx ON schedule_runs (schedule_id,
fired_for) WHERE NOT is_test`. There is also an index on `(scheduleId, createdAt DESC)`.

`bot_wakeups`:

| Column | Type | Notes |
|---|---|---|
| `projectId` | int | Cascade |
| `botId` | int | Cascade |
| `conversationId` | int | Cascade |
| `kind` | text | `sleep \| reminder` |
| `dueAt` | timestamptz | |
| `note` | text, null | |
| `status` | text | `pending \| delivered \| cancelled` |
| `requestId` | text | Unique per project |
| `createdAt` / `deliveredAt` | timestamptz | |

There is a partial index on `(conversationId, dueAt) WHERE status = 'pending'`. Phase 6's `sleep_until` is
migrated to write a `sleep` row.

`bot_webhooks`:

| Column | Type | Notes |
|---|---|---|
| `projectId` | int | Cascade |
| `botId` | int | Cascade |
| `name` | text | Unique `(botId, name)` |
| `tokenHash` | text, null | Unique partial index where not null |
| `threadId` | int | |
| `instructions` | text, null | |
| `enabled` | boolean | |
| `createdByUserId` | int | |
| `lastDeliveryAt` | timestamptz | |
| `deliveryCount` | int | |

Other changes:

- **`users` gains** `lastSeenAt`.
- **`project_settings` gains** `defaultTimezone` (`UTC`) and `botSchedulesNeedConfirmation` (`true`).
- **`bot_tasks` gains** `scheduleRunId`, nullable.

### 2. Config — `backend/config/schedules.ts`

- `minIntervalMs` (5 min), `gapScanFireTimes` (1,000), `gapScanHorizonMs` (8 days), `fireFrequencyMs` (60 s)
- `maxSchedulesPerBot` (50), `runsKept` (20), `failurePauseAfter` (3)
- `absenceDays` (14), `absenceGraceDays` (3), `lastSeenBumpMs` (10 min)
- `maxRemindersPerBot` (100), `maxReminderHorizonMs` (365 days)
- `webhookRateLimit` (60 per minute per token), `webhookMaxBodyBytes` (256 KB), `webhookMaxPendingPerHook`
  (20), `maxWebhooksPerBot` (10)

### 3. Ops — `backend/ops/{CronOps,ScheduleOps,WakeupOps,BotWebhookOps}.ts`

- **`CronOps`** is ported from ToolExec and stays the only importer of `cron-parser`. `validateCron` gains the
  minimum-gap scan and returns `{ ok, normalized, minGapMs }` or a message.
- **`compileFrequency(project, text, ctx)`** returns `{ proposal, problems }`. It makes at most one fast-model
  call, through `backend/llm/`.
- **`createSchedule`**, **`confirmSchedule`**, and **`editSchedule`** cover the lifecycle. An edit that changes
  the frequency or the cron expression clears `confirmedAt`.
- **`fireDueSchedules(now)`** returns `{ fired, skipped, raced }`. **`fireScheduleNow(id, { test })`** fires one
  schedule on demand. Both call `createTask` from [phase 13](./phase-13-leader-and-workers.md).
- **`recordRunOutcome(tx, task)`** is called from `settleTask`. It updates the run, the failure count, and the
  auto-pause.
- **`checkOwnerAbsence(now)`** handles the absence pause.
- **`addWakeup`**, **`cancelWakeup`**, **`recomputeWakeAt`**, and **`materializeDueWakeups(tx, conversationId,
  epoch)`** run under the lease fence.
- **`BotWebhookOps`** ports `WebhookOps` and reuses `readCappedBody`.

### 4. Actions — `backend/actions/{schedule,reminder,bot-webhook,webhook}/*.ts`

| Action | Route | Middleware / RBAC | Audited | MCP |
|---|---|---|---|---|
| `schedule:compile` | `POST /schedule/compile` | `canWriteBot`; rate-limited (it spends the project's model budget) | — | yes |
| `schedule:preview` | `GET /schedule/preview` | member; takes an unsaved cron and timezone | — | yes |
| `schedule:create` | `PUT /schedule` | `canWriteBot`; created unconfirmed | yes | yes |
| `schedule:confirm` | `POST /schedule/confirm` | `canWriteBot`; the exact expression is echoed back | yes, with the sentence | **never** |
| `schedule:enable` / `schedule:disable` | `POST /schedule/enable` / `POST /schedule/disable` | `canWriteBot` | yes | enable never; disable yes |
| `schedule:edit` | `POST /schedule` | `canWriteBot`; cannot set `enabled` | yes | yes |
| `schedule:delete` | `DELETE /schedule` | `canWriteBot` | yes | yes |
| `schedule:list` / `schedule:view` / `schedule:runs` | `GET /schedules` / `GET /schedule` / `GET /schedule/runs` | `canReadBot`; paginated | — | yes |
| `schedule:test-run` | `PUT /schedule/test-run` | `canWriteBot`; one open test run at a time | yes | yes |
| `schedule:keep-alive` | `POST /schedule/keep-alive` | `canWriteBot`; transfers ownership | yes | **never** |
| `reminder:list` / `reminder:cancel` | `GET /reminders` / `POST /reminder/cancel` | `canReadBot` / `canWriteBot` | cancel yes | yes |
| `bot-webhook:list` / `bot-webhook:view` | `GET /bot/webhooks` / `GET /bot/webhook` | `canReadBot`; masked URL, delivery stats | — | yes |
| `bot-webhook:rotate` | `POST /bot/webhook/rotate` | `canWriteBot`; create, rotate, or disable; plaintext returned once | yes, never the token or its hash | **never** |
| `webhook:bot-event` | `PUT /webhook/bot/:token` | `RateLimitMiddleware` only | **no** (machine ingress) | **never** |

`rbac.test.ts` adds `schedule:confirm`, `schedule:enable`, `schedule:keep-alive`, and `bot-webhook:rotate` to
the explicit never-MCP list. `webhook:*` is already covered by its prefix.

### 5. Clocks — `backend/actions/schedule/{schedules-fire,schedules-absence-check}.ts`

Both clocks are task-only, with no route, on the `orchestrator` queue.

- **`schedules:fire`** runs every 60 s. A unique violation means two workers raced; it is logged at `debug`,
  not `error`.
- **`schedules:absence-check`** runs hourly.

Reminders need no clock: `bots:dispatch` already claims them through `wakeAt`.

### 6. Bot tools — `backend/bots/tools/{schedule,wakeup}/*.ts`

All of these are DB-only and keyed by the tool call's id, so they are `replay: safe`.

| Tool | Bash tag | Inputs | Notes |
|---|---|---|---|
| `schedule_create` | `crontab -e` | `name`, `description`, `frequency`, `timezone?`, `model?`, `thread?`, `bot?` (leader only) | v1's `create_schedule`. It compiles, creates the schedule unconfirmed, and posts the confirm card. The result includes the sentence and the next fire times |
| `schedule_list` | `crontab -l` | `bot?`, `enabled?`, `limit`, `offset` | v1's `list_schedules`. Each entry shows its sentence, next run, and last run status |
| `schedule_edit` | — | `schedule_id`, `name?`, `description?`, `frequency?`, `model?`, `disable?` | v1's `schedule_edit`, as field updates rather than line patches, because descriptions are short. A new frequency means a new confirmation. It can disable but never enable |
| `remind_me` | `at` | `at` or `in`, `note`, `thread?` | |
| `reminder_list` | `atq` | `limit`, `offset` | This bot's pending reminders |
| `reminder_cancel` | `atrm` | `reminder_id` | |

PATs errors include:

- `frequency_too_frequent`, naming the gap that was found.
- `needs_confirmation`, which says a person must confirm and where the card is.
- `schedule_limit`, which suggests disabling an unused schedule.
- `reminder_too_far`.

### 7. Frontend — `frontend/src/pages/SchedulesPage.tsx`, `frontend/src/components/schedule/*`

- **`SchedulesPage`** lists every schedule in the project with its bot, sentence, next run, last run, and
  state chips (Needs confirmation, Disabled, Paused with the reason).
- **`ScheduleEditor`** starts with the frequency text and a Compile button. A review panel follows: the
  sentence, the cron, a timezone select defaulting to the browser's, the next five fire times, conditions,
  and ambiguities. Then "Save & confirm". An Advanced section edits cron directly against a debounced
  `schedule:preview`.
- **`ScheduleRunsTable`** shows the last 20 runs, linking to each root task's canvas.
- **Test run** sits behind a warning that the run performs real work.
- **`ScheduleConfirmCard`** and **`KeepAliveCard`** render inside threads.
- **The bot page** gains Schedules, Reminders, and Webhooks cards. `BotWebhookPanel` is ported from ToolExec's
  `WebhookPanel`: a one-time reveal modal with a required acknowledgement, a masked URL, a rotate confirmation
  that names the consequence, and a `curl` example that includes `X-Botholomew-Delivery`.
- **A sign-in banner** lists schedules that were paused while the user was away.

### 8. CLI — `cli/src/commands/{schedule,reminder,bot}.ts`

| Command | Wraps |
|---|---|
| `botholomew schedule create <name> --bot <slug> --frequency "every weekday at 7am" [--tz] [--yes]` | `schedule:compile`, then `schedule:create`, then `schedule:confirm`. It prints the sentence and the next five runs and asks before confirming. The description is read from stdin |
| `botholomew schedule list [--bot] [-l] [-o]` / `view <id>` / `runs <id>` | list, view, runs |
| `botholomew schedule edit <id> …` / `confirm <id>` / `enable <id>` / `disable <id>` / `delete <id>` | the matching actions |
| `botholomew schedule test <id> [--follow]` | `schedule:test-run`, then a thread follow (v1's `schedule trigger`) |
| `botholomew schedule preview "<cron>" [--tz]` | `schedule:preview` |
| `botholomew reminder list [--bot]` / `cancel <id>` | reminder actions |
| `botholomew bot webhook list <bot>` / `create <bot> <name> [--thread]` / `rotate <bot> <name>` / `disable <bot> <name>` | `bot-webhook:*` |

### 9. User docs — `frontend/src/content/docs/{schedules,webhooks}.md`

`schedules.md` covers writing a frequency, what confirmation shows, conditions, runs and missed firings, test
runs, pausing and auto-pause, reminders, and the reflection template. `webhooks.md` covers creating a hook,
the one-time URL, delivery keys, the status codes, and rotation. Update `bots.md`, `swarms.md` (schedules
create tasks), and `cli.md`.

### 10. Tests — `backend/__tests__/…`

The tests control time by writing `lastEnqueuedAt`, `lastSeenAt`, and `dueAt` directly, never by waiting.

`backend/__tests__/ops/cron.test.ts`:

- `*/7 * * * *` and `0,3 * * * *` are refused, naming the gap they produce; `*/5 * * * *` passes.
- An empty expression and an unknown timezone are refused.
- `0 9 * * *` in `America/Los_Angeles` fires at 17:00Z on one side of the March transition and 16:00Z on the
  other. That is the case ToolExec's suite lost, and the reason this test exists.
- `lastFireTimeAtOrBefore` is exact after a simulated year-long outage.

`backend/__tests__/actions/schedule-compile.test.ts`, using the fake model server:

- A phrase compiles to the expected cron and timezone, with residual conditions captured.
- Invalid model output is returned as problems and nothing is saved.
- Text that is already cron makes zero model calls.
- A project with no fast model gets a hinted refusal.

`backend/__tests__/actions/schedules-fire.test.ts`:

- A due schedule produces one run, one root task placed in its thread, and one `task.assigned` event.
- **Four parallel `schedules:fire` invocations produce exactly one run.**
- An open previous run blocks firing without advancing; once it settles, the schedule fires once with
  `missedFirings`.
- The spacing check records a skipped run.
- Unconfirmed, disabled, and paused schedules never fire.
- An edit resets the anchor only when the expression changed.
- Runs are pruned to 20.
- Run status follows the root task; three failures pause the schedule and notify.

`backend/__tests__/actions/schedule.test.ts`:

- CRUD, RBAC, and pagination.
- `schedule:confirm` with an expression different from the stored proposal returns 409.
- `schedule:edit` cannot enable.
- Audit rows carry the `describeCron` sentence.
- The never-MCP four are absent from the MCP tool list.

`backend/__tests__/actions/schedule-absence.test.ts`:

- An away owner gets one keep-alive prompt, and an unanswered prompt pauses the schedule as `owner_absent`.
- Another writer's answer keeps the schedule running and transfers ownership.
- An owner who loses write access pauses the schedule at once.

`backend/__tests__/bots/schedule-tools.test.ts`:

- A bot's `schedule_create` is unconfirmed and posts a card.
- `schedule_edit` can disable but not enable.
- The 50-schedule cap holds.
- A fired run where the bot delegates two tasks with `blocked_by` reproduces v1's `depends_on` expansion.

`backend/__tests__/bots/wakeups.test.ts`:

- A sleep and a reminder coexist, and `wakeAt` is the earlier of the two.
- Cancelling a wakeup recomputes `wakeAt`.
- **Killing the worker between dispatch and tick still delivers the reminder exactly once.**
- The horizon and count limits hold.

`backend/__tests__/actions/bot-webhook.test.ts`:

- **An unknown token, a disabled hook, a disabled bot, and a rotated token produce byte-identical responses.**
- A `token` key in the body cannot redirect the delivery.
- A body over the cap gets 413, measured while reading.
- The per-token 429 leaves other tokens unaffected.
- A missing delivery key gets 422.
- A duplicate key gets 202 `duplicate` and writes one inbox row in total.
- **`cap * 4` concurrent deliveries are accepted exactly up to the cap.**
- `authorization` and `cookie` headers are never stored.
- A rejected delivery writes no audit row.
- Rotation returns the plaintext once.

The remaining tests:

- `backend/__tests__/cli/schedule.test.ts` — `schedule create --yes` round-trips the sentence, and
  `schedule runs` paginates.
- `frontend/e2e/schedules.spec.ts` — the sentence and the next fire times appear before anything is saved;
  confirming; a test run shows up in the runs table live; the webhook reveal modal requires its
  acknowledgement.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, in the browser, with a fast model connected:

1. On the leader's page, add a schedule: "every weekday at 7am except US holidays — read the project's
   inbox notes and post a summary". Compile it. The review panel shows `0 7 * * 1-5`, your timezone, the next
   five weekdays, and "skip US holidays" as a condition. Save & confirm.
2. Press **Test run**. A run appears in the table, a root task appears on `/swarm`, and the bot's summary
   lands in the schedule's thread.
3. In chat, ask the leader to "check the build status every 30 minutes". A confirmation card appears in the
   thread with the sentence. Confirm it from the card.
4. Ask the leader to "remind me in two minutes to stretch". Two minutes later the bot posts in the thread and
   the bell increments.
5. Create a webhook named `ci` on a worker, copy the URL from the one-time modal, and `curl` it with an
   `X-Botholomew-Delivery` header. The worker's `ci` thread shows the event and the bot's reply.

Then the edge cases:

- Type `*/7 * * * *` into the Advanced field. The editor refuses it and names the 4-minute gap.
- Stop the worker for 20 minutes with a 5-minute schedule, then start it again. You get one run with
  `missedFirings: 3`, not four runs.
- Repeat the `curl` with the same delivery key. You get 202 `duplicate`, and no second event.
- `curl` with a made-up token, then with a disabled hook's token. The two responses are byte-identical.
- Set your own `lastSeenAt` 15 days back and run `schedules:absence-check`. A keep-alive card appears. Run it
  again past the grace period and the schedule is paused, with the banner on your next sign-in.
- Restart the worker between a reminder's `dueAt` and its delivery. It is delivered once.

## Definition of done

- [ ] `schedules`, `schedule_runs`, `bot_wakeups`, and `bot_webhooks`, with the indexes above; `users.lastSeenAt`
- [ ] Frequencies compile once through the fast model, are validated deterministically, previewed, and confirmed with the exact expression echoed back
- [ ] `validateCron` scans the minimum gap; the 5-minute floor holds at validation and at fire time
- [ ] `schedules:fire` has three idempotence guards, one-run catch-up with `missedFirings`, the in-flight guard, and DST-correct fire times
- [ ] Each firing is a root task placed in the schedule's thread, with a `task.assigned` event; run status follows the task
- [ ] Run records are capped at 20; test runs work; three failures pause the schedule; owner absence and lost access pause it, with a keep-alive prompt
- [ ] `schedule_create` / `schedule_list` / `schedule_edit` exist; bots cannot arm schedules
- [ ] `sleep_until` and `remind_me` are `bot_wakeups` rows behind `conversations.wakeAt`, delivered exactly once
- [ ] Per-bot webhooks use ToolExec's ingress discipline, with required delivery keys and no audit rows
- [ ] Confirm, enable, keep-alive, and rotate are audited and never MCP
- [ ] The reflection template is off by default and writes facts with sources, not themes
- [ ] The UI, `botholomew schedule|reminder|bot webhook …`, `schedules.md` and `webhooks.md`, and the doc updates

## Commands

```bash
# Compile and confirm in one step from the terminal; the description comes from stdin.
echo "Read new memory under inbox/ and post a summary" | botholomew schedule create "Morning review" \
  --bot botholomew --frequency "every weekday at 7am" --yes
botholomew schedule runs 3

# Fire a webhook the way CI would: no cookie, but a delivery key.
curl -s -i -X PUT "localhost:8080/api/webhook/bot/$TOKEN" -H 'Content-Type: application/json' \
  -H "X-Botholomew-Delivery: build-1234" -d '{"status":"failed","job":"backend-test"}'

# Clocks are task-only, so run them through the ops CLI.
cd backend && bun keryx.ts schedules:fire && bun keryx.ts schedules:absence-check
psql botholomew -c "select name, cron_expression, cron_timezone, last_enqueued_at, paused_at from schedules;"
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
