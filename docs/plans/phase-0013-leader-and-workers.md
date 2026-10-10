# Phase 13 — Leader and workers

> **Goal:** A project's leader bot can split a piece of work into tasks, hand each one to a worker bot, chain
> them into a dependency graph, and hear back when they finish or fail — without polling, without stranding
> work, and without a swarm that loops or burns its budget. People watch the whole swarm as a live task graph,
> and the leader can grow or rest its team when the project allows it.

> **Status: planned, not built.** Stage D — Swarms. Depends on [phase 5](./phase-0005-bots.md),
> [phase 6](./phase-0006-durable-bot-loop.md), [phase 7](./phase-0007-threads-and-web-chat.md), and
> [phase 10](./phase-0010-mcp-servers-and-approvals.md).

Until now every bot works alone: a person or another bot puts a message in its inbox, it thinks, it answers.
This phase makes bots a team. It is the 2.0 form of the thing v1's [field notes](https://github.com/evantahler/botholomew/blob/v1/docs/field-notes.md)
call the best surprise of the project — "watching the agent spin up its own workers when it decides it has
parallel work to do" — rebuilt on rows and conversations, not on processes and lockfiles.

v1's task system ([src/tasks/schema.ts](https://github.com/evantahler/botholomew/blob/v1/src/tasks/schema.ts),
[src/tasks/store.ts](https://github.com/evantahler/botholomew/blob/v1/src/tasks/store.ts)) is the model, and its
four failures are the spec for the port. A failed blocker stranded its dependents forever, because
`isUnblocked` only ever asks whether every blocker is `complete`. `wait_task` parked a task as `waiting` with no
wake condition, so only an approval decision ever brought one back. Nobody was told when a task finished: the
chat agent's `sleep` tool says, in its own description, that it exists for waiting "after enqueuing tasks for
workers, before checking results". And work went to whichever worker claimed it next, so "give this to the
researcher" could not be expressed at all.

The other half of the design comes from [pi-durable](https://earendil.com/posts/pi-durable/). There, a
subagent is "a conversation owned by the tool call that started it", keyed by a deterministic `requestId` so a
re-run does not start a second one, and a background task "belongs to the conversation, but not to its
current work", so the parent can go idle while the child works. Here, a delegated task is a conversation the
parent does not wait on, and its result comes back as an `event` row in the parent's inbox.

This phase leaves out recurring work, which [phase 14](./phase-0014-schedules-and-wakeups.md) builds on top of
these tasks. It also leaves out declared, human-drawn pipelines in the style of
`toolexec:docs/plans/phase-19-workflows.md`. A task graph here is emergent: bots draw it at runtime, and a
person can add to it, but nobody authors it in advance.

## Scope

**In:** `bot_tasks`, `bot_task_deps`, and `bot_task_waits`; delegation threads (`kind = delegation`,
`parentThreadId`); the `delegate` tool and the brief it delivers; priorities, the `blockedBy` DAG with
cycle checks that render the path, predecessor outputs, the terminal tools, failure propagation,
wake-on-dependency, wait with a mandatory wake condition, retry with backoff, and `parentConversationId`;
reports delivered as `event` inbox rows; `wait_for` with all-settled and fail-fast modes; task list, view,
update, and cancel for bots and people; swarm guards (depth, assignee cycles, fan-out, per-tree and
per-project caps, duplicate delegation, hop limits on worker DMs, per-tree spend); the `bots:workforce-check`
clock; leader-managed workers behind a project setting, with an audit trail; the leader's seeded playbook;
the swarm page with a task DAG; `botholomew task …` and `botholomew swarm`; user docs.

**Out:** schedules that create tasks ([phase 14](./phase-0014-schedules-and-wakeups.md)). Surfacing task
reports in Slack or iMessage ([phase 16](./phase-0016-slack.md), [phase 17](./phase-0017-imessage.md)).
Retention of settled tasks and their threads ([phase 18](./phase-0018-operations.md)). Delegation across
projects: the project is the tenancy boundary. Moving a running task to another bot; you cancel it and
delegate again. Bot templates for leader-created workers (later, unphased).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| v1 task model | Priorities, statuses, `blocked_by`, `output`, `waiting_reason`, a model pin per task | [src/tasks/schema.ts](https://github.com/evantahler/botholomew/blob/v1/src/tasks/schema.ts) |
| v1 DAG and claim | `validateBlockedBy` (DFS from each blocker back to the task), priority-then-age ordering, and `isUnblocked`, the stranding bug | [src/tasks/store.ts](https://github.com/evantahler/botholomew/blob/v1/src/tasks/store.ts) |
| v1 predecessor outputs and terminal tools | Blocker outputs injected into the first message; `complete_task` / `fail_task` / `wait_task`; a single nudge when a turn ends with no terminal tool | [src/worker/llm.ts](https://github.com/evantahler/botholomew/blob/v1/src/worker/llm.ts), [src/tools/task/](https://github.com/evantahler/botholomew/tree/v1/src/tools/task) |
| v1 self-scaling | `spawn_worker`, the precedent for a bot adding capacity on its own | [src/tools/worker/spawn.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/worker/spawn.ts) |
| ToolExec stacking guards | Depth, ancestor-cycle check with the path rendered, children-per-run and runs-per-tree caps re-taken under a lock on the **root** row, a wait that times out without failing | `toolexec:backend/actions/sandbox/sandbox-call-agent.ts`, `toolexec:backend/ops/RunOps.ts`, `toolexec:docs/plans/phase-11-agent-stacking.md` |
| ToolExec DAG execution | The ready set is an equality, not a pick; the ledger row is written before the work; fail-fast cancels siblings | `toolexec:backend/ops/WorkflowRunOps.ts`, `toolexec:docs/plans/phase-19-workflows.md` |
| ToolExec DAG view | `@xyflow/react` canvas, cycle-safe depth layout, status-coloured edges | `toolexec:frontend/src/utils/workflowDag.ts`, `toolexec:frontend/src/pages/WorkflowRunDetailPage.tsx`, `toolexec:frontend/src/components/WorkflowRunEdge.tsx` |
| One search for people and agents | A single query builder, so search never advertises a call that would be refused | `toolexec:backend/ops/AgentSearchOps.ts` |
| Bots and the leader role | `bots.role` with one leader per project, access tags, budgets, concurrency caps, the seeded leader | [phase 5](./phase-0005-bots.md) |
| The loop | Conversations, leases, `conversation_inbox` rows with `source = event`, `eventKind`, and `eventPayload` (declared there, first written here), `requestId` exactly-once for messages, `send_message`, `sleep_until` and `wakeAt`, `hopCount`, `maxBotHops`, the bot-message rate, budgets, `bot:pause`, provenance fencing | [phase 6](./phase-0006-durable-bot-loop.md) |
| Threads and notifications | `threads.parentThreadId`, owner routing, `dm` threads, content-free channels, `notifications` | [phase 7](./phase-0007-threads-and-web-chat.md) |
| Approvals | `awaiting_approval` tool calls, approval cards, recorded calls replayed exactly | [phase 10](./phase-0010-mcp-servers-and-approvals.md) |

What does not exist yet: any record that one bot asked another for a piece of work, any way for that work to
depend on other work, and any way for the asker to hear the answer without polling.

## What this must not weaken

1. **The row is the delivery.** A task, a brief, a report, and a dependency wake are each Postgres rows
   committed before any queue job. A lost Resque job delays one of them; it never loses one.
2. **One owner per thread.** The assignee owns its delegation thread. The delegator is a participant, not
   a co-owner.
3. **Delegation moves work, not authority.** The assignee acts with its own MCP allowlists and its own
   approval gates. A brief is fenced bot-to-bot text, so an instruction inside it carries no more weight
   than a DM. A leader that creates a worker cannot give it more access than the leader itself has, and it
   never touches an MCP allowlist.
4. **Every change a bot makes to the roster is audited**, with `actorBotId` and `onBehalfOfUserId`, exactly
   as a person's change would be.
5. **Human messages outrank swarm traffic.** Briefs from bots, reports, and workforce events all ride bot
   or event priority. The human-reserved slot from [phase 6](./phase-0006-durable-bot-loop.md) is untouched.
6. **Budgets bind delegated work.** Spending on a task is charged to the assignee bot and to the project
   like any other turn. Delegation is never a way around a budget.
7. **The project is the privacy boundary, and reads are still filtered by bot.** A task is readable by
   whoever can read its assignee. A tree view with an unreadable node shows a gap and a count, not the node.

## Design

### The leader is a role; leading is a convention

The [Grok Bot docs](https://docs.x.ai/grok-bot/bots) treat coordination as a convention: "The coordinator
can assign work". Nothing in the product marks one bot as in charge. Most of leading is the same here:
deciding what to split, whom to give it to, and when to check in is prompt and tools, and any bot may call
`delegate`. We still keep `role = leader` on the bot row, because three things need a fixed answer that a
convention cannot give:

- **Routing default.** An unaddressed message in a new thread needs exactly one owner — "Ask for a single
  owner at each stage", in [Grok Bot's words](https://docs.x.ai/grok-bot/chat-and-collaboration). In
  [phase 7](./phase-0007-threads-and-web-chat.md) that owner is the leader.
- **Monitoring.** `bots:workforce-check` needs a recipient for stall and failure events, and that recipient
  must exist in every project, including one where nobody has written a prompt.
- **Bootstrap.** A new project seeds exactly one bot ([phase 5](./phase-0005-bots.md)), and that bot is the only
  one that may grow the roster when the setting allows it.

The judgement goes into a seeded prompt, `bots/<leader-slug>/prompts/leading.md` (`loading: always`,
`agent-modification: true`). It says when to delegate and when to do the work yourself; to give each stage one
owner; to keep the roster small; to use `wait_for` instead of polling; and never to delegate the same thing
twice. Project bootstrap seeds it. A one-time backfill adds it to existing leaders, writing the file only where
it is absent.

### A task is a thread plus a row

`delegate` commits five things in one transaction:

1. A `delegation` thread with `parentThreadId` set to the caller's thread, `ownerBotId` set to the assignee,
   and the delegator as a participant.
2. A `bot_tasks` row.
3. Its dependency edges.
4. The brief, if the task is not blocked.
5. The assignee's inbox row, which the brief produces.

The brief is a thread message authored by whoever delegated. It reads as the task's title, description, and
priority, plus the outputs of any predecessors — the same shape v1's `runAgentLoop` built. When a person creates
the task, the brief is that person's message and carries human priority. A root task may instead be **placed**
in an existing thread its assignee already owns. That is how a person runs `task create --thread`, and the
brief is still their message in that thread. It is also how a schedule firing lands in the schedule's own
thread ([phase 14](./phase-0014-schedules-and-wakeups.md)). A schedule has no author to write a message, so
its brief arrives as a `task.assigned` event.

It is both a thread and a row because each answers a different question. The thread is where the work happens:
the assignee's conversation, which a person can read, interrupt, or steer with the chat UI from
[phase 7](./phase-0007-threads-and-web-chat.md). The row holds the facts the swarm runs on — status, the graph,
priority, attempts, output — and those have to be queryable. A thread alone would make "what is blocked on
what" a search through prose. A row alone would hide the work.

`delegate` takes the tool call's id as its `requestId`, unique per project. A tick that re-runs after a crash
gets back the task it already created, not a second one. This is pi-durable's `requestId: triage:${taskId}`
rule.

### States, and why none of them can strand

```
blocked ──every required dep succeeded──▶ pending ──assignee's turn starts──▶ running
blocked ──a required dep failed / cancelled / skipped──▶ skipped        (propagates)
running ──task_complete──▶ succeeded
running ──task_fail { retryable, attempt < max }──▶ waiting (reason: retry, wakeAt = backoff)
running ──task_fail, or attempts exhausted──▶ failed
running ──task_wait { until, on_task_ids? }──▶ waiting (reason: wait) ──condition──▶ running
any non-terminal ──task:cancel, or parent cancelled──▶ cancelled
```

**Failure propagation.** When a task settles as failed, cancelled, or skipped, every dependent still
`blocked` behind a *required* edge becomes `skipped`, naming the dependency that failed. The walk continues
breadth-first, in the same transaction, bounded by the per-tree cap. An edge may be declared
`requireSuccess: false`. A dependent behind such an edge runs once that dependency settles, however it
settled, and sees the failure among its predecessor outputs. That is all-settled semantics for one edge, for the
summariser that should report what did and did not work.

**Wake-on-dependency.** When the last required edge into a `blocked` task is satisfied, the same transaction
moves it to `pending` and posts its brief, with predecessor outputs included. There is no claim loop to wait
for: assignment is explicit, so the assignee's inbox row is the wake.

**No stranded `waiting`.** `task_wait` requires `until`. It defaults to one hour and may be at most seven
days out. It may also name `on_task_ids`, in which case whichever comes first wakes the task. A retry waits
on the same column, with exponential backoff from 1 minute, capped at 1 hour, for at most `maxAttempts`
(default 2). The `tasks:due` clock turns every due `waiting` task into a `task.resume` event for its assignee.
`bots:workforce-check` reports any task that is still waiting past its `wakeAt` plus a grace period. That
report is how we would learn the clock was broken, not how the task gets woken.

**Turns must end in a status.** A turn in a delegation conversation that started from a brief, a resume, or a
retry must end in `task_complete`, `task_fail`, or `task_wait`. [Phase 6](./phase-0006-durable-bot-loop.md)
dropped v1's mandatory terminal-tool nudge for ordinary conversations, where a final tool-free step is the
normal end. A task turn is the exception, because a parent is waiting on a status, not on prose. When a task
turn ends without one, v1's single nudge comes back: a
`system` entry, followed by one more step. If the turn still ends without a status, the task fails as
retryable with the reason "ended without reporting". A turn that started from a *person's* message in the
delegation thread is exempt, because that turn is a conversation, not the task's work.

**Predecessor outputs.** `task_complete` takes an `output` of at most 16 KB. A larger deliverable goes into
memory with `memory_write`, and the output names its `logical_path`. The tool refuses anything over the limit
and says so. Outputs are injected into the dependent's brief as v1 did — `### <title> (task #id) — succeeded`
followed by the text — fenced as bot-authored data.

### Reports come back as events; `wait_for` folds them

`delegate` records `parentConversationId`, the caller's own conversation. When a task settles, its settling
transaction inserts an `event` inbox row into that conversation, with `eventKind: task.settled`, an
`eventPayload` holding the task's id, title, status, and output or reason, and the `eventKey`
`task:<id>:settled:<attempt>`. Phase 6's inbox deduplicates only rows that point at a thread message, so this
phase adds `eventKey`, with a partial unique index on `(conversationId, eventKey)`. The report therefore
lands exactly once, however many times the settle is retried. The parent's next tick drains every pending
follow-up row into one turn ([phase 6](./phase-0006-durable-bot-loop.md)), so ten reports arriving together cost
one model call, not ten. `reportMode` (`settled | failures | none`) lets a delegator ask to hear only about
failures.

`wait_for { task_ids, mode, timeout }` registers a `bot_task_waits` row and returns at once, as `sleep_until`
does. The bot ends its turn normally, and the event wakes it. While the wait is open, individual reports for the tasks it covers are suppressed. When the wait fires,
the parent gets one `tasks.waited` event summarising every task in the group:

- **`all_settled`** fires when every task has settled.
- **`fail_fast`** fires on the first failure and may cancel the rest with `cancel_rest: true`.
- **A timeout** fires with `timedOut: true` and leaves every task running. Failing the wait would strand live
  work with no handle — the same reasoning ToolExec applied to its own wait (`toolexec:docs/plans/phase-11-agent-stacking.md`).

### Guards

[Grok Bot](https://docs.x.ai/grok-bot/chat-and-collaboration) names the failure modes: "Too many parallel
handoffs can create duplicate work and noisy updates", and unrestricted swarms add loops and quota burn.
Loops meet the depth limit, the assignee-cycle check, and the DM hop limit. Duplicate work meets the duplicate
refusal. Noise meets `reportMode`, `wait_for` folding, and deduplicated workforce alerts. Quota burn meets the
budgets and the per-tree spend cap. Each refusal is distinct and actionable, because the consumer is a model
that will try to recover.

| Guard | Default | Enforced by |
|---|---|---|
| Delegation depth | 3 | `depth = parent.depth + 1` |
| Assignee cycle | — | Walks the ancestor chain. Delegating to a bot already above you in this tree is refused, and the message renders the path: `leader → researcher → leader` |
| Open children per task | 10 | Count by `parentTaskId` |
| Open tasks per tree | 50 | Count by `rootTaskId`, a denormalized column |
| Open tasks per project | 200 | Count, under the project lock |
| Duplicate delegation | — | Same assignee and same normalized title as an open task in the tree: refused, naming the existing task id |
| DAG cycle | — | v1's DFS, rendering the path. Dependencies must stay inside one tree |
| Worker-to-worker DMs | phase 6's hop limit and bot-message rate | A DM chain with no human input stops at the limit and raises one workforce event |
| Spend per tree | off | Optional `maxSpendPerTree`, checked at `delegate` and at each task turn against `usage_events.taskId` |

The counts and the cycle walk run once as cheap early-outs. They are then taken again behind
`SELECT … FOR UPDATE` on the **root task row**, in the transaction that inserts. ToolExec learned this from a
review: lock the caller and two branches of one tree each read the same tree count, and both insert. A root
delegation has no root row yet, so it takes a per-project advisory lock instead.

Workers message each other with `send_message` over `dm` threads ([phase 6](./phase-0006-durable-bot-loop.md)).
The playbook says how to split the two: questions go in DMs, hand-offs go through tasks. A hand-off sent as a DM
has no status, no report, and no place in the graph.

### `bots:workforce-check`

A five-minute clock looks for work that has stopped moving:

- **Stalled tasks.** A task `running` with no model step or tool call for 30 minutes, and no open approval.
- **Unclaimed tasks.** A task `pending` for 15 minutes because its assignee is paused, errored, or out of
  budget.
- **Overdue waits.** A task still waiting past its `wakeAt` plus grace.
- **Quiet workers.** A bot with open tasks that is `errored` or `paused`.
- **Failing conversations.** A conversation in the project marked `errored` by the crash cap.
- **Loops.** A DM chain that hit the hop limit.

Each finding becomes one `workforce.alert` event in the leader's **Workforce** thread. That thread is a
system-origin chat thread the leader owns, created lazily the first time it is needed. Each event's
`eventKey` is `workforce:<kind>:<subject>:<level>`, so a stall is reported once per escalation level, not
every five minutes.

The leader gets the event, rather than a person, because the leader can act on it: delegate again, cancel,
or message a person. People are notified ([phase 7](./phase-0007-threads-and-web-chat.md)) only when the leader
itself is paused, errored, or out of budget, because then nobody else would hear it.

### The leader may grow and rest its team

`project_settings.leaderManagesWorkers` is `off | propose | on`, and the default is `propose`:

- **`off`** removes the tools.
- **`propose`** routes each call through [phase 10](./phase-0010-mcp-servers-and-approvals.md)'s approval gate.
  The tool call parks in `awaiting_approval`, an admin sees a card, and the call that was recorded runs
  exactly as recorded.
- **`on`** runs the call directly.

`propose` is the default because a new bot is a long-lived teammate with an identity and a budget, not a
process like v1's `spawn_worker`. Grok Bot's advice is to "ask before creating several Bots if you want to keep
the roster small".

The tools and their limits:

- **`bot_create`** seeds `identity.md` and `goals.md` from its inputs. The new bot inherits the leader's
  `accessRead`/`accessWrite`, or a narrower set, and never a wider one. It is on no MCP allowlist. It gets a
  model pin from the project registry and a budget no larger than the leader's remaining budget.
- **`bot_configure`** changes only structured fields: description, model pin, budget.
- **`bot_pause`** and **`bot_resume`** rest and restart a worker through [phase 6](./phase-0006-durable-bot-loop.md)'s
  `bot:pause` / `bot:resume` ops. The roadmap calls this "hibernating" a worker; on the row it is `paused`,
  because `hibernating` is already the derived name for an idle bot that wakes on its own. Pausing a worker
  that has open tasks requires `cancel_open_tasks: true`.

After creation, a leader may not edit a worker's prompt files; that stays with people and the worker itself.
The project also caps `maxWorkers` (12) and caps leader-created bots at 3 per day.

Every change is audited with `actorBotId` set to the leader. `onBehalfOfUserId` is the person whose message
started the chain. When a schedule started it, that is the schedule's confirmed owner
([phase 14](./phase-0014-schedules-and-wakeups.md)); when a webhook or other event started it, it is null. A bot
page then reads "created by Botholomew on behalf of Evan, from thread #41".

### The swarm page

The swarm page has two parts:

- **The roster.** Every bot with its status, open task count, and spend today.
- **The task canvas.** One tree at a time, drawn with `@xyflow/react` as ToolExec draws workflows.
  Delegation edges (parent to child) are dashed; dependency edges are solid. Nodes are coloured by status,
  and clicking one opens its delegation thread.

The layout ports ToolExec's `stepDepths`, which is cycle-safe so that a corrupt edge cannot take the page down.
Live updates arrive on `project:<id>:tasks` as frames that name nothing (`{ event: "tasks", kinds }`). A frame
carrying task ids would leak the existence of tasks whose assignee the subscriber cannot read, so this stays a
membership-only list channel in [phase 7](./phase-0007-threads-and-web-chat.md)'s sense, and the page re-reads
its access-filtered tree on each frame. The page subscribes first, then hydrates, as ToolExec's phase 18
learned to do.

## Steps

### 1. Schema — `backend/schema/{bot_tasks,bot_task_deps,bot_task_waits}.ts`

`bot_tasks`:

| Column | Type | Notes |
|---|---|---|
| `id` | serial | |
| `projectId` | int | → `projects`, cascade |
| `rootTaskId` | int | Its own id for a root task. No foreign key, as with ToolExec's `rootRunId`, so deleting one task cannot cascade a whole tree away |
| `parentTaskId` | int, null | → `bot_tasks`, set null |
| `depth` | int | 0 for a root |
| `requestId` | text | Unique `(projectId, requestId)`, the creating tool call's id |
| `title` | text | ≤ 200 characters |
| `description` | text | The brief |
| `priority` | text | `low \| medium \| high` |
| `status` | text | `blocked \| pending \| running \| waiting \| succeeded \| failed \| cancelled \| skipped` |
| `assigneeBotId` | int | → `bots`, cascade |
| `delegatorBotId` / `delegatorUserId` | int, null | Exactly one is set |
| `threadId` | int | → `threads`, cascade. The task's delegation thread, or the thread it was placed in |
| `parentConversationId` | int, null | → `conversations`, set null |
| `reportMode` | text | `settled \| failures \| none` |
| `modelName` | text, null | A pin from the project registry. Children inherit it |
| `output` / `failureReason` / `skipReason` / `waitReason` | text, null | |
| `wakeAt` | timestamptz, null | Required whenever `status = waiting` (check constraint) |
| `attempt` / `maxAttempts` | int | 0 / 2 |
| `lastActivityAt`, `startedAt`, `finishedAt`, `createdAt`, `updatedAt` | timestamptz | |

Indexes: `(projectId, status, priority, createdAt)`, `(assigneeBotId, status)`, `(rootTaskId)`,
`(parentTaskId)`, `(parentConversationId)`, and the partials `(wakeAt) WHERE status = 'waiting'` and
`(lastActivityAt) WHERE status = 'running'`.

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `bot_task_deps` | `taskId`, `dependsOnTaskId` (both cascade), `requireSuccess` (default `true`) | Primary key `(taskId, dependsOnTaskId)`; index on `dependsOnTaskId` for propagation |
| `bot_task_waits` | `projectId`, `conversationId` (both cascade), `requestId`, `taskIds jsonb number[]`, `mode` (`all_settled \| fail_fast`), `cancelRest`, `deadlineAt`, `status` (`open \| fired \| cancelled`), `firedAt` | Unique `(projectId, requestId)`; `(deadlineAt) WHERE status = 'open'` |

Other changes:

- **`project_settings` gains** `leaderManagesWorkers` (default `propose`), `maxWorkers` (12),
  `maxOpenTasks` (200), and `maxSpendPerTree` (null).
- **`bots` gains** `createdByBotId`, `pausedByBotId`, and `pauseReason`, beside phase 6's `pausedAt` and
  `pausedByUserId`.
- **`conversation_inbox` gains** `eventKey`, nullable text, with a partial unique index on
  `(conversationId, eventKey) WHERE eventKey IS NOT NULL`. The `eventKind`s this phase writes are
  `task.assigned`, `task.settled`, `task.resume`, `tasks.waited`, and `workforce.alert`.
- **`usage_events` gains** `taskId`, nullable, set when a turn runs a task.

### 2. Config — `backend/config/swarm.ts`

These are environment-overridable ceilings. Project settings may lower them, never raise them:

- `maxDelegationDepth` (3), `maxChildrenPerTask` (10), `maxTasksPerTree` (50), `maxOpenTasksPerProject`
  (200)
- `maxOutputBytes` (16 KB), `maxWaitMs` (7 days), `retryBackoffMs` (1 min → 1 h)
- `stallAfterMs` (30 min), `pendingAlertAfterMs` (15 min), `workforceCheckFrequencyMs` (5 min),
  `tasksDueFrequencyMs` (30 s)
- `maxWorkersPerProject` (12), `maxBotCreatesPerDay` (3)

### 3. Ops — `backend/ops/{TaskOps,TaskGraphOps,WorkforceOps}.ts`

- `createTask(tx, input)` — runs the guards, takes the root lock, inserts the thread (or uses the given one),
  the row, and its deps, then delivers the brief when the task is unblocked. Idempotent on `requestId`.
- `validateDependencies(tx, taskId, dependsOn)` — v1's DFS, ported. It returns the cycle path, and refuses a
  dependency in another tree.
- `settleTask(tx, taskId, outcome)` — the only writer of terminal states. One transaction under the root lock
  covers the transition, propagation (`skipped` / `pending` plus briefs), the report event, and any
  `bot_task_waits` the settle completes.
- `renderBrief(task, predecessors)` / `renderPredecessorOutputs(deps)` — the fenced brief text.
- `ancestorAssignees(tx, taskId)` — bounded by depth. It feeds the assignee-cycle message.
- `searchDelegableBots(projectId, { query }, pagination)` — one builder for `bot_list` and `bot:list`, so
  discovery never offers a bot that `delegate` would refuse.
- `findWorkforceProblems(projectId, now)` → `{ kind, subjectId, level }[]`
- `deliverWorkforceAlerts(...)` — writes the alert events.
- `broadcastTasksUpdate(projectId, kinds)` — after commit; never throws, like ToolExec's `RunChannelOps`. Its
  channel class is `backend/channels/projectTasks.ts`, with membership middleware and no per-subject
  `authorize()`, because the frame names nothing.

### 4. Actions — `backend/actions/task/*.ts`, `backend/actions/swarm/*.ts`

| Action | Route | Middleware / RBAC | Audited | MCP |
|---|---|---|---|---|
| `task:create` | `PUT /task` | `ProjectMemberMiddleware()` + `canWriteBot(assignee)` | yes | yes |
| `task:list` | `GET /tasks` | member, filtered by `canReadBot`; `status`, `botId`, `rootTaskId`; paginated | — | yes |
| `task:view` | `GET /task` | `canReadBot(assignee)`; returns deps, dependents, outputs, attempts | — | yes |
| `task:tree` | `GET /task/tree` | member. Unreadable nodes appear as `hidden: n`, never silently re-parented | — | yes |
| `task:edit` | `POST /task` | `canWriteBot`. Title, priority, and description while blocked or pending; deps re-validated | yes | yes |
| `task:cancel` | `POST /task/cancel` | `canWriteBot`; `tree: true` cascades to descendants | yes | yes |
| `task:retry` | `POST /task/retry` | `canWriteBot`; a failed or skipped task becomes pending or blocked, deps re-evaluated | yes | yes |
| `swarm:view` | `GET /swarm` | member; the roster with open-task counts and spend | — | yes |

There is no `task:delete`. A settled task and its thread are the record of what the swarm did, and retention
belongs to [phase 18](./phase-0018-operations.md). Worker management needs no new human actions:
[phase 5](./phase-0005-bots.md)'s `bot:*` already covers people.

### 5. Clocks — `backend/actions/task/{tasks-due,workforce-check}.ts`

Both clocks are task-only, with no route, on the `orchestrator` queue, and claim with `FOR UPDATE SKIP LOCKED`.

- **`tasks:due`** (30 s) delivers `task.resume` for due `waiting` tasks, and fires `bot_task_waits` past their
  deadline.
- **`bots:workforce-check`** (5 min) writes `workforce.alert` events. It notifies people only when the leader
  cannot act.

### 6. Bot tools — `backend/bots/tools/task/*.ts`, `backend/bots/tools/bot/*.ts`

Every tool here writes only Postgres, in one transaction keyed by its tool call's id. They are all
`replay: safe` by construction: the effect sandwich's unsafe path never applies to them.

| Tool | Bash tag | Who sees it | Inputs |
|---|---|---|---|
| `delegate` | — | every bot | `bot`, `title`, `description`, `priority?`, `blocked_by?` (`{ task_id, require_success? }[]`), `report?`, `model?` |
| `task_list` | `jobs` | every bot | `status?`, `bot?`, `root_task_id?`, `limit`, `offset` |
| `task_view` | — | every bot | `task_id`. Returns status, deps, outputs, and the thread id for `thread_read` |
| `task_update` | — | the delegator or the leader | `task_id`, `priority?`, `title?`, `description?`, `blocked_by?` |
| `task_cancel` | `kill` | the delegator or the leader | `task_id`, `tree?` |
| `wait_for` | `wait` | every bot | `task_ids`, `mode`, `timeout_minutes`, `cancel_rest?`. Returns at once |
| `task_complete` | `exit 0` | the assignee, in the task's thread | `output` |
| `task_fail` | `exit 1` | the assignee | `reason`, `retryable` |
| `task_wait` | — | the assignee | `reason`, `until`, `on_task_ids?` |
| `bot_list` | `who` | every bot | `query?`; delegable bots only, with description and status |
| `bot_create` / `bot_configure` | `useradd` / — | the leader, when the setting is not `off` | name, slug, description, identity, goals, model, budget |
| `bot_pause` / `bot_resume` | — | the leader, when the setting is not `off` | `bot`, `reason`, `cancel_open_tasks?` |

Errors use the PATs envelope and the closed `error_type` set from [AGENTS.md](../../AGENTS.md) rule 8. The
specific reason goes in the message and the hint, never in a new type:

- A DAG or assignee cycle is `conflict`. The message renders the path, and the hint suggests another bot.
- A duplicate delegation is `conflict`. It returns the existing task id, and the hint names `task_view`.
- A full tree, or too many open children, is `retryable`. The hint suggests `wait_for` on the open tasks.
- An oversized output is `input_error`. The hint names `memory_write`.
- Exceeding the depth limit is `permanent`. The hint suggests doing the work yourself or asking the leader.

### 7. Frontend — `frontend/src/pages/SwarmPage.tsx`, `frontend/src/components/task/*`

- `SwarmPage` contains the roster and the `TaskCanvas` (`@xyflow/react`, with `utils/taskDag.ts` ported from
  ToolExec's `stepDepths` and its execution ordering).
- The thread page gains a `TaskHeader` on delegation threads: status, attempts, deps with links, predecessor
  outputs, and Cancel / Retry.
- The bot page gains an Open tasks card and a "created by" line drawn from the audit trail.
- Settings gains a Swarm section: the `leaderManagesWorkers` radio and the caps.
- A `useLiveChannel("project:<id>:tasks")` subscription.

### 8. CLI — `cli/src/commands/{task,swarm}.ts`

| Command | Wraps |
|---|---|
| `botholomew task list [--status] [--bot] [--root] [-l] [-o]` | `task:list` |
| `botholomew task view <id> [--follow]` | `task:view`, then the thread follow from [phase 7](./phase-0007-threads-and-web-chat.md) |
| `botholomew task tree <id>` | `task:tree`, drawn as an ASCII tree like ToolExec's run tree |
| `botholomew task create --bot <slug> --title … [--blocked-by 12,13] [--priority] [--thread <id>]` | `task:create`. The description is read from stdin |
| `botholomew task edit <id> …` / `cancel <id> [--tree]` / `retry <id>` | `task:edit` / `task:cancel` / `task:retry` |
| `botholomew swarm` | `swarm:view` |

### 9. User docs — `frontend/src/content/docs/swarms.md`

A new page covers leader and workers, what delegation does, task states, dependencies, reports, guards and
the messages they produce, the workforce check, and the `leaderManagesWorkers` setting. Update `bots.md`
(roles) and `cli.md` (the `task` and `swarm` commands).

### 10. Tests — `backend/__tests__/…`

The tests drive bots with phase 6's fake model server, which serves scripted tool calls.

`backend/__tests__/bots/delegation.test.ts`:

- The leader delegates A, then B blocked by A. A's brief is delivered at once, and B is `blocked` with no
  inbox row.
- A completes, so B is `pending` and its brief contains A's output.
- B completes, and the leader's conversation gets exactly two `task.settled` events. With `wait_for` open over
  both, it gets one `tasks.waited` event instead.
- **Propagation:** in a chain A → B → C where A fails, both B and C end up `skipped` and name A. C behind
  `requireSuccess: false` runs instead.
- Re-running a tick that already called `delegate` creates no second task, because of the `requestId`. A
  task turn that ends with no status tool is nudged once, then fails as retryable.
- `task_fail { retryable: true }` waits for the backoff, then `tasks:due` delivers a resume and the attempt
  count rises.
- **No stranding:** a task waiting past its `wakeAt` gets exactly one `task.resume` from `tasks:due`.

`backend/__tests__/ops/task-graph.test.ts`: a DAG cycle is refused and the error renders the path; a
cross-tree dependency is refused; delegating back up the assignee chain is refused with the path; depth 4 is
refused; a duplicate title for the same assignee returns the existing id.

`backend/__tests__/actions/task-caps.test.ts`: **`cap * 4` concurrent `delegate` calls from four sibling
tasks in one tree accept exactly the per-tree cap** — this fails if the lock moves from the root row to the
caller — and the per-project cap holds under concurrency.

`backend/__tests__/actions/task.test.ts`: CRUD, RBAC, and pagination; edit, cancel, and retry write audit
rows; `task:tree` hides unreadable nodes and reports a count; a person's `task:create` brief carries human
priority.

`backend/__tests__/actions/workforce-check.test.ts`: each problem kind produces one alert; a second run
produces none, because of the `eventKey`; a paused leader produces a notification to admins.

`backend/__tests__/bots/leader-workers.test.ts`: under `propose`, `bot_create` parks in `awaiting_approval`,
and approving it creates the bot with an audit row carrying `actorBotId` and `onBehalfOfUserId`; under `off`
the tool is absent from the registry; access wider than the leader's is refused; the new bot is on no MCP
allowlist.

The remaining tests:

- `backend/__tests__/cli/task.test.ts` — the CLI binary against a booted server: create, list, tree, cancel.
- `frontend/e2e/swarm.spec.ts` — the canvas renders a fork and a diamond, and a node turns green live, with no
  reload, when its task completes.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, in the browser, with a project connected to a real model provider and two workers, `researcher` and
`writer`:

1. In a new thread, ask the leader to "research three competitors in parallel, then have the writer
   summarise". On `/swarm`, three research tasks run side by side, and a writer task waits `blocked` behind
   all three.
2. As each research task finishes, its node turns green without a reload. When the last one does, the writer's
   brief appears in its delegation thread with all three outputs.
3. The leader replies in the original thread once, after the writer reports, not once per report.
4. Open a research task's thread mid-flight and send a message. It is answered before the task continues,
   because human messages come first.

Then the edge cases:

- Make one researcher fail with `task_fail`. The writer is `skipped`, naming that task, and the leader hears
  about it in the same turn as the successes.
- Pause `writer` from the bot page while it holds an open task. Within one workforce interval the leader's
  Workforce thread says so, once.
- Set `leaderManagesWorkers` to `propose` and ask the leader for a new worker. An approval card appears for
  admins, and approving it creates the bot. The audit log shows the leader acting on your behalf.
- Ask two workers to keep DMing each other. The chain stops at the hop limit with one alert.
- `botholomew task tree <id>` prints the same tree the canvas draws.

## Definition of done

- [ ] `bot_tasks`, `bot_task_deps`, and `bot_task_waits`, with the indexes above and a check constraint that every waiting task has a `wakeAt`
- [ ] `delegate` creates the thread, row, deps, and brief in one transaction, idempotent on `requestId`
- [ ] `settleTask` is the only terminal writer: propagation, wake-on-dependency, the report event, and waits, all under the root-row lock
- [ ] Failure propagation is transitive, and a `requireSuccess: false` edge runs anyway
- [ ] No task can sit in `waiting` without a wake condition, and `tasks:due` delivers every due resume
- [ ] Reports are `event` rows with deterministic `eventKey`s, and `wait_for` folds them into one event
- [ ] Every guard gives a distinct, hinted refusal; cycle messages render the path; counts are re-taken under the root lock
- [ ] `bots:workforce-check` sends deduplicated alerts to the leader's Workforce thread, and notifies people only when the leader cannot act
- [ ] Leader-managed workers sit behind `off | propose | on`; access can never widen; MCP allowlists are untouched; every change is audited with `actorBotId`
- [ ] The seeded `leading.md` playbook, with a backfill for existing leaders
- [ ] The swarm page with a live `@xyflow/react` task canvas, and a task header on delegation threads
- [ ] `botholomew task …` and `botholomew swarm`; `swarms.md` plus updates to `bots.md` and `cli.md`
- [ ] Tests cover propagation, no-stranding, exactly-once reports, the concurrent per-tree cap, the cycle paths, and the audit trail for leader-created bots

## Commands

```bash
# A person delegates directly: the description comes from stdin, and the task joins task 41's tree.
echo "Summarise the three research outputs" | botholomew task create --bot writer \
  --title "Competitor summary" --blocked-by 41,42,43
botholomew task tree 41
botholomew task retry 42

# Both clocks are task-only, so run them by hand through the ops CLI.
cd backend && bun keryx.ts tasks:due && bun keryx.ts bots:workforce-check

psql botholomew -c "select id, root_task_id, parent_task_id, status, assignee_bot_id, attempt
                    from bot_tasks where root_task_id = 41 order by id;"
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
