# Phase 20 — Upstream refresh

> **Goal:** A file that came from somewhere can carry a refresh cadence. The server re-reads its source on that
> schedule, writes a new version only when the source actually changed, and shows every file's refresh health —
> so shared knowledge neither goes stale quietly nor disappears because someone else's server had a bad day.

> **Status: planned, not built.** Stage F — Memory, later. Depends on
> [phase 4](./phase-04-project-memory-core.md) (versions, `mv`, undelete), [phase 7](./phase-07-threads-and-web-chat.md)
> (notifications), [phase 9](./phase-09-memory-search-and-ingestion.md) (conversion and embedding), and
> [phase 19](./phase-19-url-ingest.md) (the guarded fetcher and the source columns it persists).

[Phase 19](./phase-19-url-ingest.md) fetches once. That is enough for a paper or a spec that will not change,
and wrong for the things teams actually point bots at: a handbook page, a pricing page, a status doc. membot
answered this with `refresh_frequency` on each file and a daemon (`membot serve --watch`) that re-reads whatever
is due. Its runner is the model for this phase — replay the persisted fetcher, compare the source sha, write a
version only on change — and its daemon is what does not survive the move: a loop in one process, holding a
DuckDB lock between ticks, with no notion of two workers, a crash halfway through, or one tenant's thousand
schedules starving another's one.

So the daemon becomes a clock that claims due rows, the way every clock in this system claims work. The refresh
itself becomes a small machine writer with three outcomes worth naming — changed, unchanged, failed — and two that
membot never had to think about: the source is **gone**, and somebody **edited** the file since it was fetched.
Neither is allowed to destroy anything.

This phase refreshes what [phase 19](./phase-19-url-ingest.md) fetched (`fetcher = 'url'`) and builds the
dispatch table that [phase 21](./phase-21-source-routers-and-bulk-sync.md)'s routers plug into. It does not
refresh uploads — the server has no path back to a person's laptop — and it never tombstones on its own.

## Scope

**In:** a `memory_refreshes` row per scheduled path (cadence, next due time, health, claim fencing); a
`systemActor` author for machine-written versions; the `memory:refresh-due` clock with a fair, `SKIP LOCKED`
batch claim; the `memory:refresh-one` child; conditional requests and the sha gate; backoff, `Retry-After`,
auto-pause, and notifications; the gone and conflict states; `memory:refresh-set`, `memory:refresh`, and
`memory:refresh-list` (audited where they change anything, MCP-visible); `memory_refresh` and a `refresh` input on
`memory_add`; schedules that follow `mv`, pause on `rm`, and resume on undelete; per-project limits; cadence and
health in the web UI and CLI; user docs; tests.

**Out:** refreshing uploads (re-run `botholomew memory add <file>`; phase 9 dedupes by sha); router and collection
replay, and the opt-in sync that *does* tombstone ([phase 21](./phase-21-source-routers-and-bulk-sync.md));
re-converting stored originals when a converter improves ([phase 23](./phase-23-original-bytes-and-blob-policy.md));
retention of the versions refresh produces ([phase 18](./phase-18-operations.md) owns `memory:prune`).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| membot's runner | `refreshOne`: replay the persisted downloader, compare `source_sha256`, write a version only on change, record `refreshed_at` / `last_refresh_status`, never throw for one bad row | [src/refresh/runner.ts](https://github.com/evantahler/membot/blob/main/src/refresh/runner.ts) |
| membot's daemon | `runDueRefreshes` and `startDaemon`: the per-tick sweep this phase replaces with a clock | [src/refresh/scheduler.ts](https://github.com/evantahler/membot/blob/main/src/refresh/scheduler.ts) |
| The operation | `membot_refresh`'s contract: one path or all due, `force`, "on failure the prior version stays current" | [src/operations/refresh.ts](https://github.com/evantahler/membot/blob/main/src/operations/refresh.ts) |
| Due query and cadence grammar | `listDueRefreshes`; `parseDuration` (`5m`, `1h`, `24h`, `7d`) | [src/db/files.ts](https://github.com/evantahler/membot/blob/main/src/db/files.ts), [src/ingest/ingest.ts](https://github.com/evantahler/membot/blob/main/src/ingest/ingest.ts) |
| Claim-and-back-off | `FOR UPDATE SKIP LOCKED` claims, `2^attempts` backoff, a `maxAttempts` terminal state | `toolexec:backend/ops/NotificationOps.ts`, `toolexec:backend/actions/notification/notifications-dispatch.ts` |
| Why `SKIP LOCKED` alone is not a limit | The dispatch claim's reasoning about concurrency caps | `toolexec:backend/ops/RunOps.ts` |
| The fetcher and its persisted identity | `guardedFetch`, `fetcher` / `fetcherArgs`, `sourceSha256`, `sourceEtag`, `sourceLastModified` | [phase 19](./phase-19-url-ingest.md) |
| Lease epochs and fenced writes | The `WHERE epoch = $mine` discipline reused for claims | [phase 6](./phase-06-durable-bot-loop.md) |
| Notifications | Rows, dispatch, the bell | [phase 7](./phase-07-threads-and-web-chat.md) |

## What this must not weaken

1. **Refresh never deletes knowledge.** A 404, a 410, a DNS failure, or an auth wall changes a status; it never
   writes a tombstone. Removing a file is a person's decision (or phase 21's explicit, guarded sync).
2. **Refresh never overwrites an edit.** If the current version is not the one the last fetch produced, a changed
   upstream pauses the schedule as a conflict instead of writing over a person's or bot's work.
3. **Append-only.** Refresh writes new versions; it never updates `content` in place. Only the
   `memory_refreshes` row is mutable, which is why the mutable state lives there and not on a version.
4. **Deterministic replay.** Refresh re-runs the persisted fetcher with the persisted arguments; no model and no
   fresh URL matching decides what to fetch.
5. **Every fetch is a phase 19 fetch** — pinned, redirect-checked, capped, public-only. A schedule is not a way
   around the guard.
6. **The row is the delivery.** A crashed refresh task loses nothing: its claim expires and the next tick
   re-claims it, and the dead task's late write is fenced out.

## Design

### Mutable state gets its own row

membot keeps `refreshed_at` and `last_refresh_status` on the current version and updates them in place
(`updateRefreshStatus`) — the one place it breaks its own append-only rule. 2.0 does not: a version is immutable,
and the schedule is a separate row, `memory_refreshes`, unique on `(projectId, logicalPath)`. That also gives the
clock a narrow table with one partial index to claim from, instead of scanning versions.

The row follows its file. Phase 4's `mv` rewrites `memory_refreshes.logicalPath` in the same transaction; `rm`
disables the schedule with `pausedReason = 'deleted'`, and undelete re-enables exactly those. A cadence on a file
without a refreshable source (an upload, an inline note) is refused with a hint.

### Who wrote it: the system

A refresh version's content came from upstream, not from whoever set the cadence, so it is authored by neither.
`memory_files` gains `systemActor` (`refresh` here; `sync`, `enrich`, and `reconvert` arrive in phases 21–23),
with a check that **exactly one** of `authorUserId`, `authorBotId`, and `systemActor` is set. The change note is
membot's, `refresh: source updated`. A manual refresh records the requester in the note
(`refresh: source updated (requested by Evan)`) and in its audit row — the asker chose *when*, not *what*.

### The clock

`memory:refresh-due` runs every 60 s on `orchestrator`. It claims up to `refreshBatchSize` rows in one statement:

```sql
UPDATE memory_refreshes SET claimed_at = now(), claim_epoch = claim_epoch + 1
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY next_refresh_at) AS rn
    FROM memory_refreshes
    WHERE enabled AND next_refresh_at <= now()
      AND (claimed_at IS NULL OR claimed_at < now() - $claimTtl)
  ) ranked WHERE rn <= $perProject ORDER BY id LIMIT $batch
)
AND enabled AND (claimed_at IS NULL OR claimed_at < now() - $claimTtl)
RETURNING id, claim_epoch;
```

The window function is the fairness — a project with a thousand due rows gets `refreshPerProjectPerTick` (10)
this tick, and a project with one gets its one. Postgres refuses `FOR UPDATE` alongside a window function, so the
claim is an `UPDATE` whose outer predicate is re-evaluated under each row lock: two overlapping ticks that rank
the same ids claim disjoint sets, because the loser re-reads a `claimed_at` it can no longer match. Each claimed
row enqueues `memory:refresh-one { refreshId, claimEpoch }` on `default` in `afterCommit`. A task that dies leaves
a claim that expires after `refreshClaimTtlMs` (10 min); every write the task makes — status, `nextRefreshAt`, the
new version's commit — is fenced on `claim_epoch = $mine`, so a task that wakes after its claim was retaken
changes nothing.

### One refresh

`refreshOne(refreshId, epoch)`:

1. Load the schedule and the file's current version; look up the version the last fetch produced
   (`lastFetchedVersionId`). Dispatch on its `fetcher` through `FETCHERS` — `url` here, `router` in
   [phase 21](./phase-21-source-routers-and-bulk-sync.md); an unknown fetcher fails with a hint to re-add.
2. Fetch, sending `If-None-Match` / `If-Modified-Since` from the stored `sourceEtag` / `sourceLastModified`. A `304`
   is **unchanged**, with no body downloaded.
3. Compare the fetched sha to the `sourceSha256` of the last *fetched* version. Equal is **unchanged**: bump
   `refreshedAt`, schedule the next run, write nothing.
4. Changed, but the current version is not the last fetched one: someone edited the file since. **Conflict** —
   write nothing, pause with `pausedReason = 'conflict'`, notify. A person resolves it with "take upstream"
   (`memory:refresh --force`, which writes the new version) or "keep mine" (clear the cadence).
5. Changed and unedited: run phase 19's sniff → convert → describe → commit with `expectedVersionId` set to the
   current version (a write that raced the refresh fails the commit, and the next tick sees the conflict), carry
   `untrusted = true`, and hand off to phase 9's embedding. **Changed.**

Only sha changes cost conversion and embedding; an unchanged page costs one conditional `GET`.

### Failure, gone, and backoff

| Outcome | Status | Next attempt | Pauses when |
|---|---|---|---|
| `304`, or same sha | `unchanged` | `refreshedAt + frequency ± 10%` jitter | — |
| New sha, unedited | `ok` | as above | — |
| New sha, edited since fetch | `conflict` | — | immediately |
| `404` / `410` | `gone` | `max(frequency, backoff)` | 3 consecutive (`pausedReason = 'gone'`) |
| `429` / `503` with `Retry-After` | `failed` | `max(backoff, Retry-After)`, capped at 24 h | 10 consecutive |
| Refused address, timeout, `5xx`, `401` / `403`, conversion error | `failed` | `max(frequency, min(5 m × 2^(n−1), 24 h))` | 10 consecutive (`'failing'`) |

A `gone` file keeps its last good content, current and searchable; `memory_info` and the info panel say "source
gone since …", and `memory_cat` adds the same to its provenance so a bot does not quote a page as live. Pausing
sends one `memory_refresh_paused` notification to the person who set the cadence (or the project's admins when a
bot did, or that person has left) linking to the file. `lastError` is truncated to 500 characters and is never a
response body.

### Cadence, limits, and who may arm it

Cadences use membot's grammar. People may choose down to `refreshMinIntervalSec` (5 min — the same floor Grok
Bot puts under routines); bots only down to `refreshBotMinIntervalSec` (1 h), because a bot that schedules a
five-minute poll of a page it saw once is the "unrestricted swarm" failure in miniature. A project holds at most
`refreshMaxSchedules` (500), and fetches at most `refreshDailyBytesPerProject` (2 GB) a day; past that, due rows
are deferred to tomorrow with status `failed: daily fetch budget reached`, not dropped. Phase 19's per-host
concurrency applies, so a hundred schedules on one site are serialized two at a time.

Setting a cadence is MCP-visible. The never-MCP list in `AGENTS.md` covers things that arm an unattended *ingress* — a
URL an outsider can trigger. A cadence arms an outbound read of a URL that is already in memory, with nothing an
outsider can call; it is closer to a routine than to a webhook.

## Steps

### 1. Schema — `backend/schema/memory_refreshes.ts`, `backend/schema/memory_files.ts`

`memory_refreshes`:

| Column | Type | Notes |
|---|---|---|
| `projectId` | `integer` → `projects.id` | cascade |
| `logicalPath` | `text` | unique with `projectId`; rewritten by `mv` |
| `frequencySec` | `integer` | ≥ the applicable floor |
| `enabled` | `boolean` | |
| `pausedReason` | `text`, nullable | `failing` \| `gone` \| `conflict` \| `deleted` \| `budget` |
| `nextRefreshAt` | `timestamptz` | |
| `refreshedAt`, `lastChangedAt` | `timestamptz`, nullable | last attempt; last new version |
| `lastStatus` | `text`, nullable | `ok` \| `unchanged` \| `failed` \| `gone` \| `conflict` |
| `lastError`, `lastHttpStatus` | `text`, `integer`, nullable | scrubbed and truncated |
| `consecutiveFailures`, `consecutiveGone` | `integer` | reset on success |
| `lastFetchedVersionId` | `text` | the version the latest fetch wrote; the conflict check |
| `claimEpoch`, `claimedAt` | `integer`, `timestamptz` | the fenced claim |
| `createdByUserId`, `createdByBotId` | `integer`, nullable | who to notify |

Index `(nextRefreshAt) WHERE enabled` for the clock; `(projectId, lastStatus)` for the health list.
`memory_files` gains `systemActor text` and the exactly-one-author check. All timestamps `withTimezone`.

### 2. Config — `backend/config/memory.ts`

`refreshDueFrequencyMs` (60 000), `refreshBatchSize` (100), `refreshPerProjectPerTick` (10),
`refreshClaimTtlMs` (600 000), `refreshMinIntervalSec` (300), `refreshBotMinIntervalSec` (3 600),
`refreshMaxSchedules` (500), `refreshMaxFailures` (10), `refreshGoneThreshold` (3),
`refreshDailyBytesPerProject` (2 GB), `refreshManualCooldownMs` (60 000).

### 3. Ops — `backend/ops/MemoryRefreshOps.ts`

- `parseCadence(input, { actor })` — membot's grammar plus the floor; a hinted refusal below it.
- `setSchedule(tx, projectId, path, cadence | null, actor)` — create, change, or clear; refuses unrefreshable sources.
- `claimDue(limit, perProject)` — the statement above.
- `refreshOne(refreshId, epoch, { force })` — the five steps; returns `{ status, versionId? }`; never throws for an upstream failure.
- `FETCHERS` / `registerFetcher(name, fetcher)` — `url` registered here.
- `nextAttemptAt(row, outcome, retryAfter?)` — the table above, pure and unit-tested.
- Hooks for phase 4: `onMove`, `onTombstone`, `onUndelete`.

### 4. Actions — `backend/actions/memory/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory:refresh-set` | `POST /memory/refresh-schedule` | `ProjectMemberMiddleware()` + write on the path | Yes | Yes |
| `memory:refresh` | `POST /memory/refresh` | `RateLimit`, `ProjectMemberMiddleware()` + write | Yes | Yes |
| `memory:refresh-list` | `GET /memory/refreshes` | `ProjectMemberMiddleware()` | — | Yes |
| `memory:refresh-due` | — (task-only, `orchestrator`, 60 s) | — | No — a clock | No |
| `memory:refresh-one` | — (task-only child, `default`) | — | No — the version and schedule are the record | No |

`memory:refresh` takes `path` or `prefix` (at most 200 files), `force`, and `wait`; without `wait` it claims and
enqueues like the clock and returns. `memory:refresh-list` is paginated and filters by `lastStatus`,
`pausedReason`, and "due now". `memory:add-url` gains `refresh`.

### 5. Clocks — `memory:refresh-due`

Task-only, no `web` route (`rbac.test.ts` already asserts clocks have none). The batch cap bounds a tick; the
fair claim bounds any one tenant; the claim TTL bounds a crash.

### 6. Bot tools — `backend/bots/tools/memory_refresh.ts`, `memory_add.ts`

`memory_refresh` — `[[ bash equivalent command: wget -N <url> ]]` — inputs `path`, `force`; `replay: safe`
(re-reading a source is idempotent in effect). One manual refresh per path per `refreshManualCooldownMs`. Its
result says `changed`, `unchanged`, `conflict`, `gone`, or `failed` with a next action for each.
`memory_add` gains `refresh` (bot floor applies). `memory_info` reports cadence and health.

### 7. Frontend — `frontend/src/pages/MemoryPage.tsx`, `frontend/src/components/memory/*`

The info panel's Source block gains cadence, last checked, last changed, next due, and status, with **Refresh
now**, **Change cadence**, and for a conflict **Take upstream** / **Keep mine**. The tree shows a status dot on
refreshing files. The Add-from-URL dialog gains a cadence select (Off, 1 h, 24 h, 7 d, custom). Settings → Memory
gains **Refresh health**: counts by status and a paginated list of failing, gone, paused, and conflicted files
with resume.

### 8. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory add <url> --refresh 24h` | Cadence at ingest |
| `botholomew memory refresh [path] [--prefix p] [--force] [--wait]` | Refresh now |
| `botholomew memory refresh-schedule <path> <cadence\|off>` | Set or clear |
| `botholomew memory refreshes [--status failed\|gone\|conflict\|paused] [--due]` | Health list; `--limit` / `--offset` |

### 9. User docs — `frontend/src/content/docs/memory.md`

"Keeping remote files current": cadences and floors, what unchanged / changed / gone / conflict mean, why refresh
never deletes or overwrites an edit, pausing and notifications, the limits.

### 10. Tests — `backend/__tests__/actions/memory-refresh.test.ts`

- The clock claims only due, enabled rows; two concurrent ticks claim disjoint sets; a project with 50 due rows
  does not starve a project with one.
- `304` and an equal sha write no version and bump `refreshedAt`; a changed sha writes exactly one version with
  `systemActor = 'refresh'`, both author columns null, and the membot change note.
- A person edits, upstream changes: no version, `conflict`, one notification; `--force` writes upstream.
- `404` three times: status `gone`, the file still current and searchable, **no tombstone**, paused and notified.
- `500`s back off on the documented curve and pause at 10; `Retry-After` is honoured and capped.
- A killed task's claim is re-taken after the TTL, and the first task's late commit is rejected by the epoch fence.
- `mv` carries the schedule; `rm` pauses it as `deleted`; undelete resumes it.
- Cadence on an upload is refused; below-floor cadences are refused, with the bot floor stricter; the 501st
  schedule is refused; the daily byte budget defers rather than drops.
- `memory:refresh-set` and `memory:refresh` write audit rows; clock-written versions write none.
- `memory:refresh-due` has no `web` route and is not an MCP tool.

`frontend/e2e/memory.spec.ts` gains: set a cadence, change the fixture, run the clock, and watch the new version
appear in history with no reload.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, with a page you control on a public host:

1. `botholomew memory add https://<host>/status.html --refresh 5m --wait`. The info panel shows the cadence and a
   next-due time.
2. Run `cd backend && bun keryx.ts memory:refresh-due` without changing the page: status `unchanged`, no new
   version in history.
3. Edit the page; run the clock again. One new version appears, authored by "refresh", with the diff showing the
   edit.
4. Edit the file in memory, then change the page again and run the clock: status `conflict`, a notification in
   the bell, no version written. Click **Take upstream**; the upstream version lands.

Then the edge cases:

- Delete the page: three ticks later the file is still current, marked gone, paused, and you were notified.
- Point a schedule at a page that returns `503` with `Retry-After: 120`: the next attempt is two minutes out.
- `mv` the file and run the clock: the new version lands at the new path.
- Kill the worker mid-refresh: after the claim TTL the next tick finishes it, and history shows one version.

## Definition of done

- [ ] `memory_refreshes` with fenced claims and health columns; `systemActor` with the exactly-one-author check
- [ ] `memory:refresh-due` claims fairly per project with `SKIP LOCKED` semantics and a claim TTL; children fenced by epoch
- [ ] Conditional requests and the sha gate; a version only on change, attributed to the system
- [ ] Conflict detection against the last fetched version; never overwrites an edit
- [ ] Gone and failing states with backoff, `Retry-After`, auto-pause, notifications; never tombstones
- [ ] `FETCHERS` dispatch table with `url` registered
- [ ] `memory:refresh-set` / `memory:refresh` audited and MCP-visible; `memory:refresh-list` paginated
- [ ] `memory_refresh` and `memory_add refresh`, with the bot floor and manual cooldown
- [ ] Schedules follow `mv`, pause on `rm`, resume on undelete; uploads refused
- [ ] Per-project schedule cap and daily byte budget
- [ ] UI cadence, health, and conflict resolution; CLI; user docs; tests as listed

## Commands

```bash
botholomew memory add https://example.com/pricing --refresh 24h
botholomew memory refreshes --status gone --json | jq '.refreshes[].logicalPath'
botholomew memory refresh remotes/example.com/pricing --force --wait
botholomew memory refresh-schedule remotes/example.com/pricing off

cd backend
bun keryx.ts memory:refresh-due                       # one clock tick by hand
psql botholomew -c "select logical_path, last_status, paused_reason, next_refresh_at
                    from memory_refreshes order by next_refresh_at limit 20;"
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then the plan
above is the only account.
