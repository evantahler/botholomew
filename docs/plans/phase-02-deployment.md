# Phase 2 — Deployment

> **Goal:** www.botholomew.com serves the app — the marketing page, the public docs, sign-up — from one Render
> staging environment, with the API and MCP endpoint at api.botholomew.com, a worker that runs every task and
> owns every migration, Postgres with pgvector proven usable, and errors reported to Sentry. Merging to `main`
> deploys it.

> **Status: planned, not built.** Stage A — Platform. Depends on [phase 1](./phase-01-clean-slate-and-shell.md),
> which leaves a trimmed, tested, never-synced `render.yaml` behind.

The shell is the cheapest thing this project will ever deploy, which is why it is deployed now. Every later
phase inherits the deployment's shape — two processes from one image, a single migrator, a queue order, a
processor count — and the bot loop in [phase 6](./phase-06-durable-bot-loop.md) is designed against that shape.
Finding out that Render's Postgres refuses `CREATE EXTENSION vector` under the app's role, or that the OAuth
issuer resolves to an internal hostname, costs an afternoon with a shell and a week with a swarm.

Most of this is ToolExec's deployment phase (`toolexec:docs/plans/phase-02-deployment.md`) with its
learnings already applied: the worker
owns migrations, the encryption key lives in a shared env group because two `generateValue` keys are two
different keys, `MCP_OAUTH_TRUST_PROXY` is on, instance types are spec ids a test pins, and the blueprint is
parsed and asserted in `bun test`. What is new is Botholomew's: the worker drains `bots` before anything else
and runs many processors because a bot tick spends its life waiting on a model; an `embed` queue is reserved
for local embeddings; pgvector must exist before [phase 9](./phase-09-memory-search-and-ingestion.md) needs it;
and www.botholomew.com — today v1's VitePress site on GitHub Pages — moves to the app.

It leaves out a production blueprint, more than one worker instance, mail, and a CDN.

## Scope

**In:** the first Blueprint sync of `render.yaml` (`botholomew-api`, `botholomew-worker`,
`botholomew-frontend`, `botholomew-redis`, `botholomew-db` on Postgres 18, the `botholomew-shared` group); the
queue order `bots, orchestrator, embed, default`, the worker's processor count and poll interval, and the
tick-slot headroom rule that makes that order safe; a migration that creates the `vector` extension; a
`status` health check that means "the schema is at least this image's"; an encryption-key fingerprint both roles
log; the env matrix; Sentry (errors only) and per-role service names; `docs/DEPLOY.md`; DNS for
`api.botholomew.com`, `www.botholomew.com`, and the apex; retiring GitHub Pages; a not-found page that sends v1
doc URLs to the `v1` branch; extending `render-blueprint.test.ts`; user docs naming the hosted URLs.

**Out:** a production environment (staging is the only one until a later decision makes a second); more than
one worker instance and the migration lock that would need ([phase 18](./phase-18-operations.md)); SMTP, which
arrives with the first feature that sends mail; OpenTelemetry metrics
and spans for the loop ([phase 6](./phase-06-durable-bot-loop.md)); the request-body cap, raised by the phase
that first accepts uploads ([phase 9](./phase-09-memory-search-and-ingestion.md)); a CDN or edge cache in
front of the frontend; frontend error reporting.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| `render.yaml` and its test | Five resources and a shared group, renamed and trimmed, asserted by a Zod parse of the real file — never synced | `render.yaml`, `backend/__tests__/deployment/render-blueprint.test.ts` from [phase 1](./phase-01-clean-slate-and-shell.md) |
| ToolExec's deployment learnings | The single migrator, the shared-group key, `MCP_OAUTH_TRUST_PROXY`, apex-for-redirect-only, `COMPUTE_PLANS`, "renaming a service is not a rename" | `toolexec:docs/plans/phase-02-deployment.md`, `toolexec:render.yaml`, `toolexec:docs/DEPLOY.md` |
| Task config | Keryx task processors, a static queue list whose order is priority | `backend/config/tasks.ts` (from `toolexec:backend/config/tasks.ts`) |
| `status` | The health action Render probes, with `tracing = false` | `backend/actions/status.ts` (from `toolexec:backend/actions/status.ts`) |
| Sentry plugin | `@keryxjs/sentry`, dark until `SENTRY_DSN` is set; `release` from `RENDER_GIT_COMMIT` | `toolexec:backend/config/{plugins,sentry}.ts` |
| Key validation | Boot fails on a bad `SECRETS_ENCRYPTION_KEY` | `toolexec:backend/initializers/secrets.ts` |
| Subprocess embedding | membot's embedder pool: inference in child processes over JSON lines, each a ~50 MB WASM heap | [src/ingest/embedder-pool.ts](https://github.com/evantahler/membot/blob/main/src/ingest/embedder-pool.ts), [src/ingest/embed-worker.ts](https://github.com/evantahler/membot/blob/main/src/ingest/embed-worker.ts) |
| What is being retired | v1's Pages workflow and custom domain; the VitePress site's page slugs | [docs-deploy.yml](https://github.com/evantahler/botholomew/blob/v1/.github/workflows/docs-deploy.yml), [docs/public/CNAME](https://github.com/evantahler/botholomew/blob/v1/docs/public/CNAME), [docs/.vitepress/config.ts](https://github.com/evantahler/botholomew/blob/v1/docs/.vitepress/config.ts) |

What does not exist: any Render resource, DNS for `api.botholomew.com`, a Sentry project for Botholomew, and the
`vector` extension in any database this application owns.

## What this must not weaken

1. **One migrator.** Only `botholomew-worker` sets `DATABASE_AUTO_MIGRATE=true`, and it runs as one instance.
2. **One encryption key.** `SECRETS_ENCRYPTION_KEY` is declared once, in `botholomew-shared`, and both roles
   prove at boot that they hold the same one.
3. **Redis is never the only copy.** `noeviction`, and nothing durable depends on a queued job surviving —
   [the row is the delivery](./README.md#core-architecture).
4. **Healthy means usable.** `status` is not healthy against a schema older than the image.
5. **The OAuth issuer is the public origin**, or every MCP client registration breaks.
6. **BYOK.** No model-provider key appears anywhere in the blueprint, in either role, ever.
7. **The deployment config is tested.** A change to `render.yaml` is a change to its suite.

## Design

### Topology

```
┌─────────────────────┐   ┌──────────────────────────┐   ┌─────────────────────┐
│ botholomew-api      │   │ botholomew-worker        │   │ botholomew-frontend │
│ web · 1c-2g         │   │ worker · 1c-2g           │   │ web · starter       │
│ backend/Dockerfile  │   │ backend/Dockerfile       │   │ frontend/Dockerfile │
│ HTTP, WebSocket,/mcp│   │ 12 task processors       │   │ nginx :10000        │
│ tasks off           │   │ migrations ON (only one) │   │ www.botholomew.com  │
│ api.botholomew.com  │   │ bots → orchestrator →    │   │ apex → 30x to www   │
│ health /api/status  │   │   embed → default        │   │ health /            │
└──────────┬──────────┘   └────────────┬─────────────┘   └─────────────────────┘
           └──────────────┬────────────┘
           ┌──────────────▼───────────┐   ┌──────────────────────────┐
           │ botholomew-redis         │   │ botholomew-db            │
           │ keyvalue · noeviction    │   │ Postgres 18 + vector     │
           └──────────────────────────┘   └──────────────────────────┘
```

API and worker share one image and differ only by environment, as in ToolExec. The frontend builds from the
repo root because `tsc -b` resolves action types through `@backend/*`, so it also rebuilds on `backend/**`.

### The worker drains `bots, orchestrator, embed, default` — and why `bots` first

Keryx's task processors are node-resque workers. Each takes **one job at a time**, and when it is free it scans
the configured queues left to right and takes the first job it finds — so the list's order is priority, and a
job holds its processor for as long as it runs. ToolExec puts `orchestrator` first because its `runs` queue held
minutes-long provisioning jobs that the orchestrator itself produced; draining them first would starve the
dispatcher that created them.

Botholomew's common path is the other way round. A person's message commits an inbox row and its `afterCommit`
enqueues `bot:tick` directly; `bots:dispatch` on `orchestrator` is the reconciler that catches what the fast
path missed, not the producer. The tick is what somebody is waiting on, so `bots` goes first. `orchestrator`
is second because its jobs are cheap queries that keep everything else honest — dispatch, reap, sweeps — and
must never wait behind embeddings. `embed` is third: a large upload enqueues hundreds of chunk batches, and a
person notices them only as search freshness, in seconds. `default` is last: retention sweeps, plus anything
enqueued with `enqueueIn` / `enqueueAt` without a queue, which Keryx sends there. That last fact is why nothing
durable in this design rides a delayed job — a wake is a `wakeAt` column read by dispatch.

### The headroom rule: tick slots are fewer than processors

`bots` first is only safe if bot ticks can never occupy every processor. A tick legitimately holds its processor
for minutes — several model steps per tick, capped near four minutes — and if all processors hold one, nothing
on `orchestrator` runs: no reaping of dead leases, no dispatch of messages whose fast-path enqueue was lost. So
the number of conversations that may hold a lease at once is **strictly less** than the processors that run
them: `TASK_PROCESSORS=12`, `BOT_TICK_SLOTS=10`, leaving two processors that always scan past `bots`. A tick that
cannot acquire a lease exits in milliseconds and its inbox row waits for dispatch, so running ticks ≤ leased
conversations ≤ slots. This phase sets the numbers, adds `backend/config/bots.ts` to carry `tickSlots`
(documented as "read by lease acquisition"), and pins `BOT_TICK_SLOTS < TASK_PROCESSORS` in the blueprint test;
[phase 6](./phase-06-durable-bot-loop.md)'s lease acquisition enforces it alongside the per-bot cap and the
project's `concurrencyLimit`.

Twelve processors on one CPU is deliberate. A tick spends almost all of its time awaiting a streamed model
response or an MCP call, so processors are concurrency, not parallelism; the limits are memory (each holds a
hydrated conversation) and Postgres connections, so the worker's `DATABASE_POOL_MAX` is 20 — at least one per
processor — against the API's 10.

### The poll interval is chat latency

An idle processor sleeps `TASK_TIMEOUT` between scans; ToolExec's 5 s default would add up to five seconds
between a person pressing send and any processor seeing the tick. The worker sets `TASK_TIMEOUT=500`. Twelve
idle processors polling twice a second is about two dozen Redis round trips a second — nothing — and
[phase 6](./phase-06-durable-bot-loop.md)'s inbox-to-tick latency metric is how the number gets revisited.

### Embeddings never run on the worker's event loop

The worker's one event loop carries every tick's token stream and every lease renewal (about every 15 s, on a
60–90 s TTL). A synchronous WASM inference batch on that loop delays all of them at once, and enough delay
loses a lease mid-stream. It also trips Keryx's `maxEventLoopDelay`, which quietly stops new processors from
spawning — a same-thread embedder would cap tick concurrency without an error anywhere. So
[phase 9](./phase-09-memory-search-and-ingestion.md) runs inference in child processes, as membot's
`embedder-pool.ts` already does, with one child on this instance type (≈50 MB of WASM heap plus the model), and
bakes the model weights into the image so a deploy never waits on a download. This phase only reserves the
queue and the memory.

### pgvector is proven by creating it

"Render offers pgvector" and "this application's role can create it in this database" are different claims,
and only the second matters. So this phase adds a hand-written migration — `CREATE EXTENSION IF NOT EXISTS
vector;` — and the worker's first boot on staging either applies it or fails loudly, long before a
`vector(384)` column depends on it. CI already runs `pgvector/pgvector:pg18`, and `docs/cloud-setup.md` already
installs the package for cloud VMs, so local, CI, and staging agree from this phase on.

### Healthy means the schema is at least the image's

ToolExec's `status` probes one column from a late migration, so the web service cannot report healthy against
an empty schema while the worker is still migrating — and someone has to move the probe with every migration.
Botholomew compares counts instead: `checks.schema` reads the number of applied migrations and compares it to
the entries in the image's own `drizzle/meta/_journal.json`; `database` is healthy only when **applied ≥
expected**. The `≥` is the point: mid-deploy, the *old* API instances run an image with fewer journal entries
than the worker has just applied, and they must stay healthy until Render swaps them. Where Keryx records
applied migrations (drizzle's `drizzle.__drizzle_migrations` by default) is verified against the pinned version
and written into the learnings.

### One key, proven without a secret to decrypt

ToolExec verifies the shared key by writing a secret through the web service and reading it in a worker task.
Nothing encrypts anything until [phase 5](./phase-05-bots.md), so `initializers/secrets.ts` logs a **fingerprint**
at boot — the first eight hex characters of SHA-256 over the key — and the runbook compares the two roles' log
lines. A truncated hash of a 256-bit random key discloses nothing useful, and a mismatch is visible on the first
deploy instead of the first decryption.

### www.botholomew.com moves from GitHub Pages to the app

Phase 1 removed the Pages workflow, so GitHub Pages serves v1's last docs build until DNS moves. The cutover
order keeps a working site at every step:

1. Sync the blueprint; `api.botholomew.com` is a new name, so its DNS record and certificate go first.
2. Lower the TTL on `www` and the apex a day ahead.
3. Point `www` at `botholomew-frontend` and the apex at the record Render names; wait for **Certificate issued**
   on both. During propagation some visitors still reach v1's docs on Pages, which is harmless.
4. After a week's soak, remove the Pages site (`gh api -X DELETE repos/evantahler/botholomew/pages`). Until then,
   pointing DNS back at Pages is the rollback.

v1's docs were published with clean URLs at the root — `/getting-started`, `/architecture`, `/skills`, eighteen
in all. Server-side redirects for them would shadow app routes later phases plausibly want (`/skills`,
`/prompts`, `/approvals`, `/tools`), so there are none. Instead the SPA's not-found page carries the list: an
unmatched path whose slug (with or without `.html`) was a v1 page renders "This was Botholomew v1's
documentation" and links the same file on the `v1` branch. A route a later phase defines simply wins.

### Observability

Sentry is `@keryxjs/sentry`, **errors only**, in a new Botholomew project. Its ingest DSN is a literal on
`botholomew-shared` — it authorizes sending events, not reading them, and `sync: false` inside a group is
ignored by Render, so a dashboard-only value could leave one role dark after a sync. `SENTRY_ENVIRONMENT=staging`
(this is staging, and it says so), `SENTRY_TRACES_SAMPLE_RATE=0`, metrics and logs off. `OTEL_SERVICE_NAME` and
`PROCESS_NAME` are the Render service names, so Sentry's `serverName` and every log line say which role spoke.
OpenTelemetry metrics stay disabled until [phase 6](./phase-06-durable-bot-loop.md) has loop spans worth
exporting. Render's health checks and logs are the rest of the observability this phase needs.

### Env matrix

| Key | api | worker | Source |
|---|---|---|---|
| `DATABASE_URL` / `REDIS_URL` | ✓ | ✓ | `fromDatabase: botholomew-db` / `fromService: botholomew-redis` |
| `NODE_ENV`, `LOG_LEVEL`, `LOG_INCLUDE_TIMESTAMPS`, `LOG_COLORIZE` | ✓ | ✓ | group: `production`, `info`, `true`, `false` |
| `SECRETS_ENCRYPTION_KEY` | ✓ | ✓ | group: `generateValue: true`, checked for 32 bytes |
| `FRONTEND_URL` | ✓ | ✓ | group: `https://www.botholomew.com` — the worker builds links too |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_ENABLE_METRICS`, `SENTRY_ENABLE_LOGS` | ✓ | ✓ | group literals |
| `PROCESS_NAME`, `OTEL_SERVICE_NAME` | `botholomew-api` | `botholomew-worker` | literal |
| `WEB_SERVER_ENABLED` | default | `false` | literal |
| `WEB_SERVER_HOST` / `_PORT` / `_API_ROUTE` / `_THEME` | `0.0.0.0` / `10000` / `/api` / `theme/botholomew-theme.ts` | — | literal |
| `WEB_SERVER_ALLOWED_ORIGINS` | `https://www.botholomew.com` | — | literal, never the apex |
| `APPLICATION_URL` | `https://api.botholomew.com` | — | literal; the OAuth/MCP issuer base |
| `SESSION_COOKIE_SECURE` / `_SAME_SITE` | `true` / `None` | — | literal |
| `MCP_SERVER_ENABLED`, `MCP_OAUTH_TRUST_PROXY` | `true`, `true` | — | literal |
| `DATABASE_AUTO_MIGRATE` | `false` | **`true`** | literal |
| `DATABASE_POOL_MAX` | `10` | `20` | literal |
| `TASKS_ENABLED` / `TASK_PROCESSORS` | `false` / `0` | `true` / `12` | literal |
| `TASK_TIMEOUT`, `BOT_TICK_SLOTS` | — | `500`, `10` | literal |
| `VITE_API_URL` (frontend build arg) | | | `https://api.botholomew.com` |

Instance types are ToolExec's validated ones: `1c-2g` for both backend roles (the worker's headroom is for
embedding later), `starter` for the frontend and Redis, `basic-256mb` on `postgresMajorVersion: "18"` for the
database — revisited when [phase 9](./phase-09-memory-search-and-ingestion.md) builds HNSW indexes.

## Steps

### 1. Schema — `backend/drizzle/0001_pgvector.sql`

A custom migration (drizzle-kit's empty `--custom` migration, filled by hand and added to the journal) holding
`CREATE EXTENSION IF NOT EXISTS vector;` and a comment saying why it precedes any vector column. Confirm Keryx's
migrator applies a journal entry it did not generate; if it does not, that is a Keryx issue to file upstream.

### 2. Config — `backend/config/{tasks,bots,database}.ts`

`tasks.ts`: `queues: ["bots", "orchestrator", "embed", "default"]`, with the two paragraphs above as its comment.
`bots.ts` (new): `tickSlots: loadFromEnvIfSet("BOT_TICK_SLOTS", 2)` and its `KeryxConfig` augmentation.
`backend/.env.example` raises development's `TASK_PROCESSORS` from 1 to 4 so the default slots fit under it;
tests keep `TASK_PROCESSORS_TEST=0` and drive tasks with `runAction` / `drainTasks`, where the rule does not
apply. The rule is also a **boot assertion**, not only a blueprint test: `initializers/taskHeadroom.ts` refuses
to start a process with tasks enabled, processors above zero, and `tickSlots >= taskProcessors`, naming both
variables — so a dashboard override cannot quietly undo it. `database.ts` is unchanged; `DATABASE_POOL_MAX` is
already an env key.

### 3. Health and key fingerprint — `backend/actions/status.ts`, `backend/initializers/secrets.ts`

`status` gains `checks.schema: { applied, expected }` and reports `database` healthy only when `applied >=
expected`; the column probe goes. `secrets.ts` logs `SECRETS_ENCRYPTION_KEY fingerprint <8 hex>` at `info`;
`CryptoOps` exports `keyFingerprint()`.

### 4. Blueprint — `render.yaml`

Everything in the env matrix, `domains:` on the API (`api.botholomew.com`) and frontend (`www.botholomew.com`,
`botholomew.com`), `maxmemoryPolicy: noeviction`, and no `numInstances` or scaling block on the worker. The
apex appears in `domains:` and nowhere else.

### 5. Frontend — `frontend/src/pages/NotFoundPage.tsx`, `frontend/src/utils/v1Docs.ts`, `frontend/index.html`

`NotFoundPage` moves out of `App.tsx`. `v1Docs.ts` holds the eighteen v1 slugs and builds
`https://github.com/evantahler/botholomew/blob/v1/docs/<slug>.md`. `index.html` gets a real `<title>`, a
description, and Open Graph tags, since www.botholomew.com is now a page people share.

### 6. Runbook — `docs/DEPLOY.md`

Topology; rehearsing locally (both images, the env pulled from the blueprint); first deploy (create the
Blueprint, check the generated key decodes to 32 bytes or replace it with `openssl rand -base64 32`, confirm the
Sentry DSN, DNS for `api`, verify); the www cutover above; the verify checklist; ongoing deploys and the
`buildFilter` table; "renaming a service is not a rename"; rollback (forward-only migrations — a revert is a new
migration); restoring a dump (create `vector` first, then `pg_restore`, then `bun run db:repair-sequences`); and
why the worker stays at one instance. [AGENTS.md](../../AGENTS.md)'s Deployment section links it.

### 7. CLI — no new commands

This phase adds no action. `DEFAULT_BASE_URL` has been `https://api.botholomew.com` since phase 1; this is the
phase that makes it answer.

### 8. User docs — `frontend/src/content/docs/{getting-started,cli,mcp}.md`

Name the hosted origins: sign up at www.botholomew.com, `botholomew login` with no `--url`, and the MCP
connector address `https://api.botholomew.com/mcp`. Say plainly that the service is in development.

### 9. Tests

`backend/__tests__/deployment/render-blueprint.test.ts` (extended):
- Only the worker migrates, runs tasks, and sets `BOT_TICK_SLOTS`; the worker declares no `numInstances` above 1
  and no autoscaling.
- `BOT_TICK_SLOTS < TASK_PROCESSORS`, `DATABASE_POOL_MAX ≥ TASK_PROCESSORS`, and `TASK_TIMEOUT ≤ 1000` on the
  worker.
- No key matching `/ANTHROPIC|OPENAI|_API_KEY|MODEL/` anywhere in the file.
- Sentry: the DSN and the four toggles are on the group, `SENTRY_ENVIRONMENT` is `staging`, and each role's
  `OTEL_SERVICE_NAME` equals its service name.
- Each public origin names a domain attached to the service that answers it; the apex is attached to the
  frontend and named by no env var; the database is Postgres `18`.

`backend/__tests__/config/tasks.test.ts` (new):
- `config.tasks.queues` is exactly `["bots", "orchestrator", "embed", "default"]`.
- Every registered action with a `task` names a queue in that list. A job on a queue nobody drains never runs
  and nothing reports it.

`backend/__tests__/config/task-headroom.test.ts` (new):
- `assertTaskHeadroom` throws for `tickSlots >= taskProcessors` with tasks on, names both variables, and passes
  with tasks off or zero processors — the API role and the test process.

`backend/__tests__/schema/pgvector.test.ts` (new):
- `pg_extension` has `vector` after migrations, and `'[1,2,3]'::vector <-> '[1,2,4]'::vector` returns `1` —
  the operator works, not just the catalog row.

`backend/__tests__/actions/status.test.ts` (extended):
- Healthy after migrations with `applied === expected`; the comparison is healthy for `applied > expected` (the
  old image mid-deploy) and unhealthy for `applied < expected`.

`backend/__tests__/ops/crypto.test.ts` (extended):
- `keyFingerprint()` is eight hex characters, stable for one key, different for another, and the boot log line
  never contains the key.

`frontend/src/__tests__/not-found.test.ts` (new) and `frontend/e2e/smoke.spec.ts` (extended):
- Every v1 slug, with and without `.html`, maps to its `v1` branch URL; an unknown path gets the plain page.
- Visiting `/architecture` in a browser renders the v1 link inside the normal layout.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Locally, before merging: both `docker build`s from phase 1, then boot the backend image with the API's env
pulled from the blueprint against the local services, and confirm `/api/status` reports `schema.applied ===
schema.expected`.

After the first deploy, in order:

1. `botholomew-worker`'s log shows the migrations applied, including the extension; `botholomew-api`'s log shows
   no migration activity.
2. Both roles log the same key fingerprint.
3. `curl https://api.botholomew.com/api/status` → `healthy: true`, `database`, `redis`, and `schema` all good.
4. `curl https://api.botholomew.com/.well-known/oauth-authorization-server` → `issuer` is
   `https://api.botholomew.com`.
5. `psql "$RENDER_EXTERNAL_DATABASE_URL" -c "select extversion from pg_extension where extname = 'vector'"`
   returns a version.
6. Cut over www as the Design says; `https://www.botholomew.com` serves the marketing page, `/docs` reads
   signed out, and `https://botholomew.com` answers a 30x to www.
7. Sign up on www.botholomew.com; the session cookie carries `Secure` and `SameSite=None`; invite a second
   address and accept it.
8. `botholomew login` (no `--url`), `botholomew project list`; add `https://api.botholomew.com/mcp` to Claude as
   a connector and list the project's members through it.

Then the edge cases:

- Touch only `frontend/**`: only the frontend rebuilds. Touch only `backend/**`: all three do.
- During a deploy that adds a migration, the old API instance stays healthy until it is replaced.
- `https://www.botholomew.com/skills` and `/getting-started.html` render the v1 link, not a blank page.
- An error raised in an action on each role appears in Sentry tagged `environment=staging` with the right
  `serverName`; local `bun dev` and CI stay dark.
- `redis-cli -u "$REDIS_URL" config get maxmemory-policy` reports `noeviction` where Render permits the query;
  otherwise the dashboard shows it.

## Definition of done

- [ ] The Blueprint is synced: `botholomew-api`, `botholomew-worker`, `botholomew-frontend`, `botholomew-redis`, `botholomew-db` (Postgres 18), and `botholomew-shared`
- [ ] Only the worker migrates and runs tasks, as one instance; queues are `bots, orchestrator, embed, default`
- [ ] `TASK_PROCESSORS=12`, `BOT_TICK_SLOTS=10`, `TASK_TIMEOUT=500`, worker pool 20, all pinned by the blueprint test
- [ ] A process with tasks on refuses to boot unless tick slots are fewer than processors
- [ ] `vector` is created by a migration on staging, in CI, and locally; its operator is tested
- [ ] `status` is healthy only when applied migrations ≥ the image's journal
- [ ] Both roles log the same key fingerprint; the generated key decodes to 32 bytes
- [ ] The OAuth issuer is `https://api.botholomew.com`; cookies are `Secure` / `SameSite=None`; CORS allows exactly www
- [ ] www and the apex serve from Render with certificates; GitHub Pages removed after the soak
- [ ] v1 doc URLs land on a not-found page that links the `v1` branch
- [ ] Sentry receives errors from both roles, tagged `staging`; no model-provider key anywhere in the blueprint
- [ ] `docs/DEPLOY.md` written and linked from AGENTS.md; user docs name the hosted origins

## Commands

```bash
curl -s https://api.botholomew.com/api/status | jq '.healthy, .checks'
curl -s https://api.botholomew.com/.well-known/oauth-authorization-server | jq -r .issuer
curl -sI https://botholomew.com | head -1                       # a 30x, Location on www
dig +short www.botholomew.com CNAME                              # Render, not github.io
gh api repos/evantahler/botholomew/pages --silent && echo "Pages still on (fine until the soak ends)"
cd backend && bun test __tests__/deployment/render-blueprint.test.ts
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
