# Phase 18 — Operations

> **Goal:** The service can run for years. Data ages out on a schedule a project can read and change. People,
> projects and organizations can leave cleanly while their audit record survives. The encryption key rotates
> without downtime. Every project sees what its bots cost on its own key. Nightly evals catch behaviour
> regressions before people do. An operator can see, throttle and restore the whole system.

> **Status: planned, not built.** Stage E — Everywhere. Depends on [phase 2](./phase-02-deployment.md),
> [phase 3](./phase-03-organizations.md), [phase 6](./phase-06-durable-bot-loop.md),
> [phase 8](./phase-08-context-management.md), [phase 10](./phase-10-mcp-servers-and-approvals.md),
> [phase 11](./phase-11-code-mode.md), [phase 16](./phase-16-slack.md) and [phase 17](./phase-17-imessage.md),
> because it sweeps, deletes or re-encrypts their tables.

Every earlier phase writes rows, and none of them removes any. [Phase 6](./phase-06-durable-bot-loop.md)
records every model step and tool call. [Phase 8](./phase-08-context-management.md) compacts in the
background, but following pi-durable it **never deletes the entries it compacted**. Old entries stay so that
a conversation can be audited, replayed or re-compacted. [Phase 4](./phase-04-project-memory-core.md)'s
memory is append-only, and only admin-run retention may remove old versions. Without this phase, every one of
those promises turns into an unbounded table and an unbounded bill for whoever runs Postgres.

The phase also closes the operational gaps the ToolExec shell left open. ToolExec has no way to delete a
user, and its `audit_logs.userId` foreign key would block one. Its `CryptoOps` has one key and no key id, so
the key can never be rotated. Its usage numbers live on a run page and nowhere else. This phase leaves the
data model alone and puts the lifecycle around it: retention, deletion, rotation, dashboards, alerts, evals,
observability and restore.

What it leaves out is anything that changes the shape of the product. A portable project dump and
organization billing stay on the README's unphased list. Stripping blob bytes belongs to
[phase 23](./phase-23-original-bytes-and-blob-policy.md). Provisioning production belongs to the deployment
work after [phase 2](./phase-02-deployment.md), and the runbooks here are written so production can adopt them
unchanged.

## Scope

**In:** one retention system (a daily `retention:sweep` fanned out per project, batched, with defaults per
table and per-project overrides); the rule that retention deletes conversation entries only behind the
hydration base; `memory:prune` and a per-project version policy; account deletion, and project and
organization deletion as a seven-day tombstone followed by a sweep; audit rows that survive every deletion;
a keyring with key ids and online re-encryption for `SECRETS_ENCRYPTION_KEY`; `usage_daily` rollups and usage
pages per project, bot and organization; budget and runaway alerts; growing phase 6's nightly harness into a
scored regression suite; tracing, metrics, alerts, Sentry scrubbing and `@keryxjs/resque-admin`; the backup and
restore runbook; and a rate-limit review backed by an enumeration test.

**Out:** project dump/apply (unphased; ToolExec's `ProjectDumpOps` is the reference when it comes).
Organization billing (unphased). Blob-byte stripping ([phase 23](./phase-23-original-bytes-and-blob-policy.md)).
A platform-operator web UI over project content. Deliberately never; see "Observability".

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| Batched retention | `runs:sweep`: the row survives and the bulk goes; 5,000 rows per batch, each in its own transaction; 200 batches per tick; a `truncated` flag | `toolexec:backend/actions/run/runs-sweep.ts` |
| Whole-row retention | `notifications:sweep` and `audit:sweep`; age measured from `createdAt` | `toolexec:backend/actions/notification/notifications-sweep.ts`, `toolexec:backend/actions/audit/audit-sweep.ts` |
| Audit that outlives its subject | No FK on `projectId`, immutable rows, `writeAuditLog` for changes made inside shared ops | `toolexec:backend/schema/audit_logs.ts`, `toolexec:backend/ops/AuditOps.ts`, `toolexec:docs/plans/phase-05-audit-logging.md` |
| Deleting with external state | `project:delete` destroys provider-side resources while the credentials still exist | `toolexec:backend/actions/project/project-delete.ts` |
| AES-256-GCM and the boot check | One key, a fresh IV per write, no plaintext fallback, and a bad key fails the deploy | `toolexec:backend/ops/CryptoOps.ts`, `toolexec:backend/initializers/secrets.ts` |
| Cost estimates | "A wrong price is worse than a missing one, and a silent zero is worst"; cache read and write multipliers | `toolexec:backend/ops/ModelPriceOps.ts`, `toolexec:backend/ops/RunUsageOps.ts` |
| Sequence repair after restore | Discovers sequences through `pg_get_serial_sequence`, never moves one backwards, safe to re-run | `toolexec:backend/scripts/repair-sequences.ts` (copied in [phase 1](./phase-01-clean-slate-and-shell.md)) |
| Limits and telemetry config | Rate-limit defaults; `/metrics` with basic auth; errors-only Sentry with per-service names | `toolexec:backend/config/{rateLimit,observability,sentry,plugins}.ts`; `toolexec:docs/plans/phase-02-deployment.md` learnings |
| Keryx plugins | `@keryxjs/tracing` (OpenTelemetry for HTTP, actions, tasks, Redis, Drizzle) and `@keryxjs/resque-admin` (queues, workers, failed jobs, locks) | <https://keryxjs.com/plugins/> |
| membot `prune` | `--before`, dry-run by default, the current version never touched | [src/operations/prune.ts](https://github.com/evantahler/membot/blob/main/src/operations/prune.ts) |
| v1 usage accounting | Cache-token normalization across providers; context breakdown | [src/llm/usage.ts](https://github.com/evantahler/botholomew/blob/v1/src/llm/usage.ts), [src/chat/usage.ts](https://github.com/evantahler/botholomew/blob/v1/src/chat/usage.ts) |
| The loop's ledger and harness | `usage_events`, per-bot and per-project budgets, the fake model server, the nightly eval harness | [phase 6](./phase-06-durable-bot-loop.md) |

## What this must not weaken

1. **Retention is the only deleter, and it never breaks hydration.** Compaction never deletes. Retention
   removes conversation entries only strictly before a conversation's hydration base, so a conversation
   idle for a year still resumes.
2. **Audit rows outlive what they describe.** `audit_logs` has no foreign key to projects, users or bots.
   Deleting a person, a project or an organization leaves the record of that deletion and everything
   before it, until audit retention.
3. **The project is the boundary.** Usage, retention settings, prune and deletion are each scoped to one
   project, or one organization for its owners. No operator tool browses project content.
4. **BYOK.** A cost figure estimates the customer's own provider bill. The platform bills nothing, and an
   unpriced model shows *unpriced*, never `$0`.
5. **No secret is ever plaintext at rest, not even mid-rotation.** Every ciphertext names its key. A key
   that rows still need cannot be removed without failing the deploy.
6. **Postgres is the only copy of anything durable.** A restore needs Postgres and the keyring, and nothing
   else. Losing Redis loses no work.
7. **Every human decision is audited**: retention changes, prune, every deletion and restore. Sweeps,
   rollups and re-encryption are clocks and stay unaudited, per `AGENTS.md` rule 5.
8. **Evals never gate CI**, and nothing in a product code path uses a platform model key.

## Design

### Retention: one sweep, per-project fan-out, batches

`retention:sweep` runs daily on `orchestrator` and enqueues `retention:sweep-project {projectId}` for every
live project, so a very large project cannot starve the rest. Each child applies the project's effective
policy table by table, in ToolExec's batches (5,000 rows, one transaction each, at most 200 batches per tick,
`truncated` reported). Order matters: the inbox and tool bodies go before entries, and entries before
scratch files, so nothing is deleted while a newer row still points at it.

| Data | Default | What goes | What stays |
|---|---|---|---|
| `conversation_inbox` | 7 days after claim | the row | — |
| `conversation_entries` | 90 days | entries older than the window **and** before the hydration base | everything from the base onward |
| `tool_calls` | 90 days | `args` and `result` bodies, nulled | tool, server, status, timings, the `approvals` link |
| `model_steps` | 90 days | the row | its `usage_events` |
| `usage_events` | 90 days, and only once rolled up | raw rows | `usage_daily` for 25 months |
| `thread_messages` | 365 days | messages; a thread with no messages left and no live conversation | newer messages |
| `scratch/conversations/<id>/` | 14 days after the last write there | every version, chunk and orphaned blob | — |
| memory, non-current versions | kept (policy off) | versions older than *D* days beyond the newest *N* per path | the current version, always |
| memory, tombstoned paths | 30 days | the whole history of the path | — |
| `notifications`, `outbox` | 30 days (outbox: after a terminal status) | the row | — |
| `audit_logs` | 365 days, platform-wide | the row | — |

Admins override any per-project value in `projects.retentionPolicy`. The floor is 7 days, `null` means keep
forever, and scratch and the inbox are operational and not configurable. Audit retention rises from
ToolExec's 90 days to 365 days. Here the audit log also records what bots changed (prompts, skills,
workers), and that question gets asked long after the fact. Thread messages outlive conversation entries on
purpose. A bot whose old context was swept can still recall the human-visible record through
[phase 8](./phase-08-context-management.md)'s `thread_search`. Slack and iMessage text gets no second rule:
it is a thread message.

### Conversation entries: delete only behind the hydration base

pi-durable keeps old entries forever and lets compaction change only what is hydrated. Botholomew keeps that
inside the window and adds one deleter. For each conversation with entries older than the cutoff:

1. If its latest `compaction` or `reset` entry is newer than every expired entry, delete the expired entries
   before it.
2. Otherwise (no base, or a base that has itself expired), and only if the conversation is not leased, take
   the lease the way a tick does: bump `leaseEpoch` so any racing tick's fenced writes affect zero rows.
   Then write a deterministic `reset` entry: *Earlier conversation (before 2026-07-12) was removed by the
   project's retention policy; search the thread for the human-visible record.* Delete everything before it
   and release the lease. **No model call.** Summarizing with a compaction would spend the customer's key to
   delete their data.
3. A leased conversation is skipped and picked up the next day.

`system` entries recording which prompt `versionId`s the model saw go the same way. The audit trail for a
prompt change is `audit_logs` plus memory history, which have their own windows.

### Memory versions: `memory:prune` and the policy

`memory:prune` (admin, audited, dry-run by default) is membot's `prune --before` ported. Its inputs are
`before`, `keepLast`, `pathPrefix` and `dryRun`, and it returns counts per prefix. It never touches a current
version. Reserved paths (`prompts/`, `bots/*/prompts/`, `skills/`) are kept unless `pathPrefix` names them,
because prompt history is how a person audits what a bot was told. The retention sweep calls the same op with
the project's `memoryVersions` policy, which is off by default, so nothing is pruned until an admin opts in.
That keeps phase 4's promise: only admin-run retention removes versions. Pruning a version deletes its
chunks and embeddings, and a `memory_blobs` row no version references any more is deleted in the same batch.
Stripping bytes from blobs that are still referenced is [phase 23](./phase-23-original-bytes-and-blob-policy.md)'s.
**Scratch** is the one hard purge that bypasses tombstones by design. Large results there are working
material, not history.

### Deleting a person

`user:delete` requires the account password and a typed confirmation. It is **never MCP**: it is
irreversible and takes a credential, which is the same class as signup and login, so `AGENTS.md` rule 6's
list gains it. It refuses, naming each blocker and the next step, when the user is the sole owner of an
organization with other members (transfer ownership) or the sole admin of a project with other members
(promote someone). Otherwise it does the following in one transaction:

- Projects and organizations where the user is the only member are tombstoned with `purgeAfter = now()`
  (`deletedReason: account`). Nobody else could restore them.
- Memberships, organization memberships, user tags, remote identities, reach rows and notifications cascade.
- Authorship is set to null. The project's record keeps its content and shows *former member*: thread
  messages, memory versions, approval decisions, enabled channels. A schema-introspection test asserts every
  foreign key to `users` is `cascade` or `set null`, so a forgotten `NO ACTION` can never block a deletion.
- `audit_logs.userId` loses its foreign key, as `projectId` already has in ToolExec. The `user:delete` row is
  written, plus a synthetic `membership:delete` per project left (through `writeAuditLog`), so each project's
  log records the departure.
- `afterCommit` destroys sessions, revokes OAuth and MCP tokens, and enqueues `projects:sweep`.

The `users` row is hard-deleted, and signing up again creates a new person. What remains is stated in the
docs: content the person wrote inside projects, which belongs to the project; and audit rows until audit
retention, some of which (invites) carry their email.

### Deleting a project or an organization: a tombstone, then a sweep

Phase 1 copies ToolExec's one-statement cascade. That is wrong for a store holding a team's memory, where one
mis-click destroys years of work. In this phase `project:delete` sets `deletedAt` and `purgeAfter = now() + 7
days`. In the same transaction it pauses every bot and schedule and bumps every conversation's `leaseEpoch`,
so in-flight ticks write nothing more. Membership middleware treats a tombstoned project as not found, except
for `project:view` and `project:restore` for its admins, and Slack and Linq ingress return their
byte-identical 404. `project:restore` (admin, audited) undoes the tombstone within the window. Bots stay
paused until someone resumes them.

`projects:sweep` (daily) purges what is past `purgeAfter`, in the order ToolExec's `project:delete` taught:
**external cleanup while the credentials still exist.** First it deletes Linq webhook subscriptions and
revokes MCP OAuth tokens where the server supports revocation (best effort, and failures are logged and
recorded in metrics). A Slack app belongs to the workspace and cannot be deleted from here, so the
delete-confirmation dialog tells the admin to remove it in Slack. Then it deletes the bulk children in batches
(chunks, memory versions, blobs, entries, tool calls, messages) and finally the project row, which cascades
the rest. Audit rows survive with no FK. Provider keys go with the row, and the docs tell admins to revoke
them at the provider too.

`organization:delete` (owner, audited) tombstones the organization and every project in it with
`deletedReason: organization`. `organization:restore` restores exactly those projects. `projects:sweep`
deletes an organization row once no project references it.

### Rotating `SECRETS_ENCRYPTION_KEY`: key ids and a keyring

Every encrypted column set gains a `keyId`. The migration sets existing rows to `k1`, since one key wrote all
of them. One registry, `ENCRYPTED_COLUMNS`, lists them:

| Table | Columns |
|---|---|
| `project_connections` | credential and refresh triples (model keys; Slack and Linq secret maps) |
| `mcp_credentials` | access and refresh tokens |
| `oauth_client_registrations` | client secret |
| `approvals` | the encrypted elicitation answer ([phase 10](./phase-10-mcp-servers-and-approvals.md)) |
| `code_runs` | the parked continuation ([phase 11](./phase-11-code-mode.md)) |

A schema test asserts that every column whose name ends in `ciphertext` belongs to a registered set, so the
next encrypted column cannot skip rotation. `SECRETS_ENCRYPTION_KEY` stays the active key, and
`SECRETS_ENCRYPTION_KEY_ID` (default `k1`) names it. `SECRETS_ENCRYPTION_RETIRED_KEYS`
(`k1:<base64>,…`) are decrypt-only. All three live in the `botholomew-shared` env group, the ToolExec
lesson about keys minted per service. Encryption always uses the active key. Decryption picks the key by the
row's `keyId`. An unknown id is a typed error naming it, never a bare "decryption failed". **At boot**, the
secrets initializer reads the distinct `keyId`s across the registry and fails the deploy if any is not
configured. Removing a key that rows still need is a failed deploy, not a support ticket weeks later.

`secrets:reencrypt` is task-only and re-enqueues itself until it is done. It walks each table in batches of
500 with `FOR UPDATE SKIP LOCKED WHERE keyId <> $active`, decrypts with the old key, encrypts with the
active one, and updates `WHERE id = $id AND keyId = $old`. A concurrent token refresh either committed first
(the row is already on the active key and is skipped) or waits on the lock. The task is resumable and
idempotent. Parked `code_runs` continuations are signed with a key that phase 11 derives from the master key
by HKDF, so re-encrypting would not re-sign them. `secrets:status` therefore reports them, and the operator
either waits (they are short-lived) or runs `secrets:rotate --expire-parked`. That fails each one with phase
11's "verify before retrying" result, which is the "re-encrypts or expires" choice phase 11 left here.

Rotation protects future ciphertext. It does not undo a leak of the database together with a key. In that
case the runbook has every project admin notified with their list of connections to revoke upstream. The
Keryx session secret and OAuth signing keys rotate separately and are documented beside this.

### Usage: the customer's own spend

`usage_events` ([phase 6](./phase-06-durable-bot-loop.md)) carries one row per model step: project, bot,
conversation, model, connection, input, output, cache-read and cache-write tokens, an estimated cost in
micro-dollars or null when the model is unpriced, and `estimated` for abandoned spend. The hourly
`usage:rollup` recomputes `usage_daily` for the last two UTC days by upsert, so a late event or a rerun is
harmless. Dashboards read only the rollup:

- **Project → Usage**: tokens by category, **cache hit rate** (`cacheRead / (input + cacheRead +
  cacheWrite)`, the regression signal for phase 8's prompt-cache discipline), estimated cost, and steps, by
  day, bot or model.
- **Bot → Usage** tab: the same figures for one bot.
- **Organization → Usage**: totals per project, for organization owners.

Rows for bots the viewer cannot read are folded into *other bots*. Every page says, in as many words:
*Estimated spend on your own provider keys. Botholomew does not bill for model usage; Anthropic or OpenAI
does.* Prices come from phase 6's price table under ToolExec's rule. A model without a price shows
*unpriced*, and the totals say how many steps it covers. Embeddings run locally and cost nothing, so they are
not shown as spend.

### Budgets and alerts

Phase 6 enforces budgets by refusing the next model step. This phase adds warning before refusal.
`budgets:alert` (every 15 minutes) notifies project admins and the bot's writers through phase 7's
notifications at 50%, 80% and 100% of a monthly bot or project budget, **once per threshold per period**
(`budget_alerts` unique key). It also raises a **runaway** alert when a bot's spend in the last hour exceeds
ten times its trailing seven-day hourly average and one dollar. That catches the swarm loops Grok Bot warns
about and phase 6's guards missed. Organizations get an alert-only `monthlyBudgetMicros`. With no billing
and no organization-level permissions, a hard stop there would be a policy nobody can see.

### Behaviour evals become a regression suite

Phase 6's nightly harness drives bots against a real model. This phase gives it scenarios and scores.
`backend/evals/scenarios/<area>/<name>.ts` each export a **seed** (project, bots, prompt and memory files,
fake MCP servers with canned tools and outputs), a **script** (human messages and timed events), and
**graders**. Deterministic graders are assertions over Postgres: the exact set of `tool_calls`, approvals,
messages and memory writes. Rubric graders are scored by a model against a fixed rubric. A scenario's score
is the weighted mean, run three times per provider.

| Area | Representative scenarios |
|---|---|
| Delegation | A three-part ask goes to the right workers by description; `wait_for` collects them; a trivial ask is not delegated; step and token ceilings hold |
| Approval | A gated call asks; a denied call is not retried; an `unknown` outcome is verified before any retry |
| Memory recall | A fact written in one thread is found from another with `memory_search`; `thread_search` recalls an old decision; an absent fact is reported absent, not invented |
| Prompt-injection resistance | Instructions inside MCP output, a fetched page, a Slack shared message and a worker's report cause no unrequested tool call, no `send_message`, and no write under `prompts/`, and the reply mentions the suspicious text. Graded by tool-call set equality |
| Output discipline | Silence when another bot is addressed; final text that stands alone; cache hit rate above its floor across a multi-turn script |

The nightly workflow (`.github/workflows/evals.yml`) runs against a local stack with the team's own eval
provider keys, held as repository secrets. That is BYOK: the eval project is an ordinary project with an
ordinary connection. Results are a JSON artifact and a job summary, compared with the committed
`backend/evals/baseline.json`. A drop of more than 0.15 on any scenario, or 0.05 on an area mean, fails the
nightly run and opens or updates an `eval-regression` issue. It is never a required check, per `AGENTS.md`.
The baseline changes only by pull request, linking the run that justifies it. `bun run evals --scenario
'approval/*'` runs a subset locally. CI runs only the harness's self-test against the fake model server.

### Observability

- **Traces:** `@keryxjs/tracing` exports OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT`. Phase 6's tick → model step →
  tool call spans nest under the task span. Every error trace is kept, and 10% of the rest. Span attributes
  are **ids only** (project, bot, conversation, thread), never message text or tool arguments. Content stays
  in Postgres under project RBAC.
- **Metrics:** Keryx's `/metrics` (ToolExec's `OTEL_METRICS_*` config, basic auth) plus the loop's own
  metrics: inbox-to-tick latency, tick duration, steps per turn, failed lease renewals, abandoned steps,
  `unknown` outcomes, errored conversations, approval wait, outbox latency and failures by transport and
  reason, ingress rejections by transport and reason, queue depth per queue, embed lag, retention rows per
  table, and re-encryption progress.
- **Dashboards and alerts** live as code in `ops/dashboards/`. Alerts fire on: inbox-to-tick p95 over 30 s for
  10 minutes; an errored-conversation spike; outbox failure rate over 5%; `bots` queue depth growing for 15
  minutes; Redis memory over 80% (`noeviction` means a full Redis refuses writes); Postgres connections over
  80%; and a surge in signature failures, which means either an attack or a secret rotated on one side only.
- **Sentry** stays errors-only, as ToolExec learned. A `beforeSend` hook drops request bodies for `webhook:*`
  and for message and memory actions, and strips `content`, `text`, `body`, `args` and every `SENSITIVE_KEYS`
  key, because Sentry is a third party outside every project's boundary.
- **Queues:** `@keryxjs/resque-admin` is mounted on the API only when `RESQUE_ADMIN_ENABLED=true`, behind
  operator basic auth from the shared env group. It shows queues, workers, failed jobs and locks. Retrying a
  failed job from it is safe, because every job re-reads its rows. `@keryxjs/admin`, the table browser, is
  deliberately **not** installed: it would give operators an unaudited web view of every project's content.

### Backup and restore

Everything durable is in Postgres, including memory bytes (`bytea`), so Render's managed backups are the
backup. Production will require point-in-time recovery. Redis is not backed up. Losing it costs sessions
(people sign in again), link codes (minted again) and queued jobs, and the clocks find those again from rows
(`bots:dispatch`, `remote:dispatch`, `notifications:dispatch`). The runbook in `docs/DEPLOY.md`:

1. Scale the worker to zero and put the API in maintenance.
2. Restore into a **new** database and point `DATABASE_URL` at it.
3. `bun run db:repair-sequences`. A restore that loads explicit ids without advancing sequences makes the
   next insert collide, which is the bug ToolExec's script exists for.
4. Confirm the keyring holds every `keyId` in the restored rows. The boot check enforces this, which is why
   **a retired key is kept in the operator vault for as long as any backup that needs it exists.**
5. `bun run outbox:quarantine --before <restore point>`. Rows sent after the backup was taken come back
   `pending`. Re-sending them would double-post to Slack, and Linq's idempotency window is not ours to rely
   on, so they are marked `failed: restored` and never sent automatically.
6. Start the worker, then the API. Expired leases settle through `bots:reap`, and pending inbox rows dispatch.
7. Verify `/api/status`, then `connection:probe` on one connection (proving decryption), then one bot reply.

Inbound Slack and iMessage messages after the restore point are lost, because neither service redelivers
days later. The runbook says so. A restore drill into staging runs every quarter and its duration is
recorded.

### Rate limits, reviewed

Limits are spread across phases, and the review gathers them in one table in `security.md`: Keryx's
per-IP and per-user limits (ToolExec's 20 and 200 a minute), OAuth registration (5 an hour), each `webhook:*`
per routing token and per identity, link-code attempts, per-project bot-message rate and the pending-inbox
cap, schedules at least 5 minutes apart, upload size and URL fetches, and code-mode limits. Then
`rate-limits.test.ts` enumerates every action with a `web.route` and asserts that it is behind a limiter or on a
named, argued exception list, the same shape as `rbac.test.ts`. Every 429 carries `Retry-After`, and the CLI
honours it. The review also checks dispatch fairness. If phase 6's `bots:dispatch` orders purely by priority
and age, it gains a per-project cap per tick, so one busy project cannot fill the `bots` queue.

### Data export, later

A full project dump/apply format stays unphased, and ToolExec's `ProjectDumpOps` is the starting point when it
comes. Until then the interim path is documented: `botholomew memory pull <prefix> <dir>` for files, prompts
and skills; `botholomew thread view <id> --json` per thread; and `botholomew audit list --json`.

## Steps

### 1. Schema — `backend/schema/{usage_daily,budget_alerts}.ts`, plus changes

| Table | Key columns | Constraints |
|---|---|---|
| `usage_daily` | `projectId` (cascade), `botId` (set null) with `botName` snapshot, `day` (date), `model`, `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` (bigint), `steps`, `costMicros` (bigint, nullable), `unpricedSteps`, `estimatedSteps` | unique `(projectId, botId, day, model)` |
| `budget_alerts` | `scope` (`bot` \| `project` \| `organization`), `scopeId`, `period` (`YYYY-MM`, or an hour bucket for runaway), `kind` (`threshold` \| `runaway`), `threshold`, `createdAt` | unique `(scope, scopeId, period, kind, threshold)` |

Changes:

- `projects` gains `deletedAt`, `purgeAfter`, `deletedReason` (`project | organization | account`), and
  `retentionPolicy` (jsonb, default `{}`). A partial index on `purgeAfter` where it is not null.
- `organizations` gains `deletedAt` and `monthlyBudgetMicros`.
- `keyId` (text, not null, default `k1`) on every table in `ENCRYPTED_COLUMNS`.
- `audit_logs.userId` drops its foreign key.
- Every foreign key to `users` becomes `cascade` or `set null`.

### 2. Config — `backend/config/{retention,secrets,observability}.ts`

`retention`: the default table above (`RETENTION_*_DAYS`), `retentionMinDays` (7), `sweepBatchSize`
(5,000), `sweepMaxBatches` (200), `projectTombstoneDays` (7). `audit.retentionDays` defaults to 365.
`secrets`: `encryptionKey`, `encryptionKeyId` (`k1`), `retiredKeys`. `observability`: the OTLP endpoint, the
trace sample ratio (0.1), `RESQUE_ADMIN_ENABLED`, and the operator basic-auth pair.

### 3. Ops — `backend/ops/{RetentionOps,DeletionOps,UsageOps,BudgetAlertOps}.ts`, `CryptoOps.ts` (keyring)

- `RetentionOps`: `effectivePolicy(project)`, `sweepProject(projectId)` (one table at a time, returns counts
  and `truncated`), and `retireConversationHistory(conversationId, cutoff)` (the base rule, writing a `reset`
  under a fenced lease).
- `MemoryOps.prune(tx, projectId, { before, keepLast, pathPrefix, dryRun })` is shared by the action and the
  sweep.
- `DeletionOps`: `deletionBlockers(userId)`, `deleteUser(tx, userId)`, `tombstoneProject(tx, id, reason)`,
  `restoreProject(tx, id)`, and `purgeProject(id)` (external cleanup first, then batches).
- `CryptoOps`: `encryptSecret` returns `{ …, keyId }`; `decryptSecret(record, keyId)`;
  `ENCRYPTED_COLUMNS`; `reencryptBatch(table, limit)`.
- `UsageOps`: `rollupDays(from, to)`, `summary({ projectId | organizationId, botIds, since, until, groupBy
  })` filtered by `canReadBot`, and `cacheHitRate(row)`.
- `BudgetAlertOps`: `checkThresholds(now)` and `checkRunaways(now)`, each inserting into `budget_alerts`
  first and notifying only when the insert succeeds.

### 4. Actions — `backend/actions/{usage,project,organization,user,memory}/*.ts`

| Action | Route | Middleware / RBAC | Audited | MCP |
|---|---|---|---|---|
| `usage:summary` | `GET /usage` | member (bots filtered by `canReadBot`); organization scope for owners | read | human MCP |
| `project:retention-edit` | `POST /project/retention` | admin | yes | human MCP |
| `memory:prune` | `POST /memory/prune` | admin | yes, unless `dryRun` | human MCP |
| `project:delete` (changed) | `DELETE /project` | admin | yes | as [phase 1](./phase-01-clean-slate-and-shell.md) |
| `project:restore` | `POST /project/restore` | admin of the tombstoned project | yes | human MCP |
| `organization:delete` (changed) / `organization:restore` | `DELETE /organization` / `POST /organization/restore` | owner | yes | as [phase 3](./phase-03-organizations.md) / human MCP |
| `user:delete` | `DELETE /user`; `password` is a `secret()` field | session | yes | **never** |

### 5. Clocks / tasks — `backend/actions/{retention,projects,usage,budgets,secrets}/*.ts`

| Task | Queue | Frequency | Notes |
|---|---|---|---|
| `retention:sweep` | `orchestrator` | daily | Fans out `retention:sweep-project {projectId}` |
| `retention:sweep-project` | `default` | one-off | Batched, ordered, reports `truncated` |
| `projects:sweep` | `orchestrator` | daily | Purges past `purgeAfter`; deletes empty tombstoned organizations |
| `usage:rollup` | `orchestrator` | hourly | Idempotent upsert of the last two UTC days |
| `budgets:alert` | `orchestrator` | 15 min | Thresholds and runaways, once each |
| `secrets:reencrypt` | `default` | one-off, re-enqueues itself until done | Enqueued only by the rotate script |

All are plain `Action`s with no `web` route and `mcp = { tool: false }`. `rbac.test.ts`'s clock enumeration
gains them.

### 6. Scripts — `backend/scripts/{secrets-rotate,secrets-status,outbox-quarantine}.ts`

`bun run secrets:rotate [--expire-parked]`, `bun run secrets:status` (rows per `keyId` per table, plus parked
code runs), and `bun run outbox:quarantine --before <ts>`, beside the existing `bun run db:repair-sequences`.
Each starts Keryx in CLI mode the way `repair-sequences.ts` does.

### 7. Evals — `backend/evals/`, `.github/workflows/evals.yml`

The scenario files, graders, a runner (`bun run evals`), `baseline.json`, and the nightly workflow with the
issue-on-regression step. `backend/evals/__tests__/` holds the harness self-tests that CI runs against the fake
model server.

### 8. Frontend — `frontend/src/pages/{UsagePage,OrganizationUsagePage,SettingsPage,AccountPage}.tsx`

The usage pages and the bot Usage tab (with the BYOK sentence and *unpriced* labels). Settings → Data
retention (the effective policy beside its defaults, edits, and a memory-prune form with a dry-run preview).
Settings → Danger zone (delete, then a tombstone banner with a countdown and *Restore*). Account → Delete
account (blockers listed with links). Organization settings delete and restore.

### 9. CLI — `cli/src/commands/{usage,project,org,account,memory}.ts`

| Command | Calls |
|---|---|
| `botholomew usage [--bot <slug>] [--since 30d] [--group-by day\|bot\|model] [--org]` | `usage:summary` |
| `botholomew project retention [show\|set <key>=<days\|forever>]` | `project:view` / `project:retention-edit` |
| `botholomew memory prune [--before <date>] [--keep-last <n>] [--prefix <p>] [--yes]` | `memory:prune` (a dry run without `--yes`) |
| `botholomew project delete\|restore`, `botholomew org delete\|restore` | the matching actions |
| `botholomew account delete` | `user:delete` (prompts for the password and the confirmation) |

### 10. User docs and runbooks — `frontend/src/content/docs/{usage,data-retention}.md`, `docs/DEPLOY.md`

The new `usage.md` (what the numbers are, cache hit rate, BYOK, alerts) and `data-retention.md` (the defaults
table, overrides, prune, what deletion keeps), registered in `sections.ts`. Updates to `security.md`
(encryption and rotation, deletion, the limits table), `teams.md` (leaving and deleting), and `cli.md`.
`docs/DEPLOY.md` gains "Rotating the encryption key", "Backup and restore" and "Observability". `AGENTS.md`
rule 6 gains `user:delete`.

### 11. Tests — `backend/__tests__/{operations,actions,scripts}/*.test.ts`

- `retention.test.ts`: defaults and overrides; entries behind the base deleted, and never from the base on; an
  idle conversation without a base gets a `reset` and the fake model server records **zero** requests; a
  leased conversation is skipped; a racing tick's fenced write affects zero rows; tool bodies nulled with the
  skeleton kept; raw usage deleted only once its rollup exists; scratch purged; `truncated` past the batch
  ceiling.
- `memory-prune.test.ts`: a dry run writes nothing; the current version survives every policy; `keepLast`;
  reserved prefixes kept unless named; tombstoned paths purged after the window; chunks and orphaned blobs
  removed; audited; a non-admin gets 403.
- `user-delete.test.ts`: blockers named; cascades; authorship set to null; audit rows survive, plus one
  `membership:delete` per project; the next request with the old session is 401 and the OAuth token is
  refused; absent from human MCP. `schema/foreign-keys.test.ts`: no foreign key to `users` is `NO ACTION`.
- `project-delete.test.ts`: the tombstone hides the project and fences in-flight ticks; ingress returns the
  byte-identical 404; restore within the window; the sweep purges after it; the Linq subscription is deleted
  before the credentials; audit rows survive. `organization-delete.test.ts`: restore brings back exactly the
  projects it tombstoned.
- `crypto-rotation.test.ts`: new writes carry the active `keyId`; retired keys decrypt; re-encryption
  converges while a concurrent writer refreshes a token; boot fails naming an unconfigured `keyId`; every
  `*ciphertext` column is registered; parked code runs block *done* until expired.
- `usage.test.ts`: rollup is idempotent across reruns; cache hit rate; unpriced is null, never 0; unreadable
  bots folded; the organization view is owner-only. `budget-alerts.test.ts`: each threshold fires once per
  period; runaway detection.
- `rate-limits.test.ts`: every routed action is limited or on the named exception list.
- `observability.test.ts`: the Sentry `beforeSend` strips content keys; an in-memory span exporter sees ids and
  no message text; resque-admin is a 404 when disabled and a 401 without operator auth.
- `scripts/repair-sequences.test.ts` and `scripts/outbox-quarantine.test.ts`: explicit-id inserts followed by
  repair let the next insert succeed; quarantined rows are never claimed.
- `frontend/e2e/operations.spec.ts`: the usage page renders seeded rollups with the BYOK sentence; delete, the
  banner, restore.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, against a project with a few weeks of seeded history:

1. Settings → Data retention: set conversation entries to 7 days. Run `bun keryx.ts retention:sweep`, then
   drain. Old entries are gone, a `reset` entry sits where history used to start, and the bot still answers
   in that thread.
2. `botholomew memory prune --before 2026-09-01` prints counts. Re-run with `--yes`. Current files are
   unchanged and the audit log shows `memory:prune`.
3. Project → Usage: tokens, cache hit rate, *unpriced* where expected, and the BYOK sentence. `botholomew
   usage --group-by bot --json` matches.
4. Set a bot's budget just above its spend, then send it a message. Within 15 minutes the 80% and 100%
   notifications arrive, once each.
5. Rotate: add a new key as active with `k2` and the old one as retired, deploy, `bun run secrets:rotate`,
   then `bun run secrets:status` until `k1` shows zero rows. Remove `k1` and deploy. `connection:probe`
   still passes.
6. Delete the project. The banner counts down, Slack mentions get nothing, and *Restore* brings it back with
   the bots paused.

Then the edge cases:

- Remove a retired key while rows still use it. The deploy fails at boot, naming the key id.
- Delete an account that is the sole admin of a shared project. The blocker names the project and the fix.
- Restore a staging backup into a new database by following the runbook. `db:repair-sequences` reports what
  it advanced, quarantined outbox rows are not re-sent, and a bot replies afterwards.
- Enable resque-admin without credentials. Requests get 401.
- Break a scenario's expected tool set locally with `bun run evals --scenario 'approval/*'`. The run reports
  the regression against the baseline.

## Definition of done

- [ ] `retention:sweep` with per-project fan-out, batches, the defaults table, per-project overrides, and the hydration-base rule with model-free `reset`s
- [ ] `memory:prune` (dry run by default, audited) and the opt-in version policy; scratch purge; orphaned blobs deleted
- [ ] `user:delete` with blockers, set-null authorship, surviving audit rows, and synthetic membership rows; never MCP; the FK introspection test
- [ ] Project and organization tombstones with restore, fenced ticks, ingress 404, and `projects:sweep` doing external cleanup first
- [ ] Keyring with `keyId` on every registered encrypted column, the boot check, resumable `secrets:reencrypt`, and parked-run handling
- [ ] `usage_daily`, `usage:summary`, and the usage pages and CLI with the BYOK wording and *unpriced*
- [ ] `budgets:alert` thresholds and runaway alerts, once each
- [ ] Scored eval scenarios in five areas, a baseline, a nightly workflow that opens issues, and harness self-tests in CI
- [ ] Tracing with id-only attributes, loop metrics, dashboards and alerts as code, Sentry scrubbing, gated resque-admin
- [ ] `DEPLOY.md` runbooks for rotation, backup and restore (including outbox quarantine), and observability
- [ ] The rate-limit table and the enumeration test
- [ ] User docs `usage.md` and `data-retention.md`, plus the listed updates

## Commands

```bash
cd backend
bun keryx.ts retention:sweep            # fan-out; then drain the default queue
bun keryx.ts usage:rollup
bun run secrets:rotate && bun run secrets:status
bun run outbox:quarantine --before 2026-10-01T00:00:00Z
bun run db:repair-sequences             # after any restore
bun run evals --scenario 'prompt-injection/*' --provider anthropic
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
