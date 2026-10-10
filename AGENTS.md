# AGENTS.md — Botholomew

Botholomew is a **cloud service of always-on bot swarms**. Every project has a team of bots — one **leader**
and any number of **workers** — that do work, watch work, hibernate when idle, and wake when a person, another
bot, a schedule, or an event gives them something to do. They share the project's **memory**, **MCP
servers**, and **skills**; each has its own prompts, identity, and goals; people reach them from the website,
the CLI and TUI, Slack, and iMessage.

Built on **[Keryx](https://www.keryxjs.com/)** — one Action class is simultaneously an HTTP endpoint, a CLI
command, a background task, and an OAuth-protected MCP tool.

**This file is the working summary: the rules, the conventions, and enough architecture to find your way.**
It is the one instruction file for every coding agent and every person working here; `CLAUDE.md` is only a
symlink to it, so edit `AGENTS.md`.
The reasoning behind each decision lives with the plan that ships it, in [`docs/plans/`](./docs/plans/README.md).
Every doc there ends in a **Learnings from the build** section, and that is where to read before changing
something load-bearing, and where to write when you learn something new. See
[Where the detail lives](#where-the-detail-lives) for the map.

> **Status: 2.0 is planned, not built.** The plans are complete; the code is not. Until
> [phase 1](./docs/plans/phase-01-clean-slate-and-shell.md) lands, the tree still holds the **v1** local CLI/TUI
> agent (`src/`, `test/`, `docs/*.md`), which is frozen — do not extend it. v1 lives permanently on the
> [`v1` branch](https://github.com/evantahler/botholomew/tree/v1). Sections below that describe `backend/`,
> `frontend/`, and `cli/` describe the codebase phase 1 creates; where a rule names a file, that file arrives
> with the phase that introduces it.

## Non-negotiable rules

1. **Tests required.** Every code addition ships with tests. Tests drive a **real booted server over HTTP**
   against an isolated test database — no mocks. Third parties are replaced by real servers we run: a
   `Bun.serve` fake model provider, a fake MCP server, fake Slack and Linq APIs, and a deterministic fake
   embedder.
2. **JSDoc everywhere.** Every method and exported function has a JSDoc annotation/description.
3. **CRUD includes a paginated `list`.** Every CRUD action set includes a `list` action using Keryx's
   `paginationInputs({ defaultLimit: 25 })` / `paginate`, which page by `page` + `limit` and answer with a
   `pagination: { page, limit, total, pages }` envelope alongside the named collection.
4. **Keryx bugs go upstream.** If you hit a bug in **Keryx itself** (the framework or its scaffolder — not our
   code), do **not** work around it. File an issue at
   [`actionhero/keryx`](https://github.com/actionhero/keryx/issues) with a minimal repro, then stop and
   surface it. We fix Keryx upstream first.
5. **Every data-changing action is audited.** Any action that inserts, updates, or deletes extends
   `AuditedAction` and implements `runWithAudit(tx, params, connection)`, routing **every** write through `tx`
   and setting `connection.metadata.auditBefore` / `auditAfter`. Never log secrets: `before` / `after` must be
   `serializeX()` output, and `insertAuditLog` scrubs the `SENSITIVE_KEYS` denylist from `metadata` — a new
   secret-bearing param means adding its key to that list in the same commit.

   The exceptions are a closed list, and the plan that adds each one argues it: read-only actions, sweep and
   dispatch clocks, `session:create` / `session:destroy`, the bot loop's own machinery (`bot:tick`, the
   transcript it writes), token-authenticated machine ingress (`webhook:*`), and the notification and outbox
   families. In every case the audited thing is the **decision a person made** — sending a message, answering
   an approval, editing a bot, connecting a credential — and the machine's record is a better transcript
   elsewhere. A change a **bot** makes to shared state (creating a worker, editing a prompt or a skill) is
   audited too, with `actorBotId` and `onBehalfOfUserId` set.
6. **Human MCP ≈ HTTP; never-MCP is a closed list.** Almost every action with a `web.route` is published as an
   MCP tool for human OAuth clients (Claude, IDEs) — the API and MCP are the same product surface, which is
   how a person's own assistant can message their bots and read project memory.
   `applyMcpToolPolicy` / `shouldPublishAsMcpTool` in `ops/McpToolPolicyOps.ts` is the source of truth;
   class-level `mcp.tool` is the boot default and is overwritten at initialize. `rbac.test.ts` asserts every
   action's live flag equals that function.

   **Never MCP, for anyone:** login/signup (`user:create`, `session:create` / `session:destroy`),
   `webhook:*` (token-authenticated machine ingress, asserted by prefix), unauthenticated introspection
   (`status`, `swagger`, `actions:permissions`), OAuth browser hops (`gateway:oauth-*`, Slack install
   hops), clocks (`task.frequency > 0`), anything with no `web.route`, anything that arms an unattended
   ingress (rotating a webhook token), and minting a remote-identity link code — a model that could mint a
   code and repeat it to somebody else could bind that person's Slack account to yours.
7. **Bot tools are not actions.** What a bot can do is an in-process `ToolDefinition` in `backend/bots/tools/`,
   executed only by a tick, on behalf of that bot, under that bot's grants — never a person's session. A
   bot never holds a token that could call the HTTP or MCP surface. When a bot needs something a person can
   do, write a bot tool over the **same `ops/` function** the action calls; never route a bot through an
   action, and never publish a bot tool as one.
8. **Bot tools speak bash and answer with hints.** A tool that behaves like a familiar command carries
   `[[ bash equivalent command: <cmd> ]]` at the start of its description (`memory_cat`, `memory_ls`,
   `memory_mv`). Every error is a structured envelope — `is_error`, `error_type`
   (`input_error | not_found | conflict | auth_error | retryable | permanent`), `message`, and a
   `next_action_hint` that names the tool to call next — classified structurally, never by substring.
   Outputs are token-efficient: acknowledgements and previews, not echoed bodies. These are the
   [Patterns for Agentic Tools](https://arcade.dev/patterns/llm.txt).
9. **Postgres first, then the network — in both directions.** An inbound message is a row before we
   acknowledge it; an outbound message, a model call, and a side-effecting tool call are each a row before we
   perform them. The row is the delivery and the queue is an accelerant: anything enqueued in `afterCommit` is
   also found by a clock that reads the rows.
10. **No credential and no network inside code mode.** Guest code runs in QuickJS-in-WASM with host functions
    only. A model key, an MCP credential, or a fetch never crosses into the sandbox, and a host function never
    takes a URL.
11. **LLM access goes through `backend/llm/`.** Never import `ai`, `@ai-sdk/*`, or a provider plugin from
    outside it. Models resolve at boundaries through `resolveModel` / `resolveFastModel` / `resolveModelFor`
    — precedence is always `--model` > a task or schedule pin > the bot's or project's default — and a
    function whose model the caller chooses takes an explicit model argument. Keys are the project's own
    (BYOK); the platform holds no model key.
12. **Never name a plan phase outside `docs/plans/`.** No comment, JSDoc block, test name, config note, or doc
    says "Phase 9" or "this phase". The phases are a schedule for building the thing, not a fact about it, and
    a reader six months from now has the code but not the plan. Say what a column, hook, or placeholder is
    *for* — "read by the refresh clock, which does not exist yet" — because that stays true after the
    schedule is forgotten and it survives the plan being reordered.
13. **User-facing docs ship with the feature.** Any change that alters something an operator or visitor can
    see or do — a settings section, a bot tool, a memory namespace rule, an interface, an RBAC rule, or a
    marketing claim — updates the markdown under `frontend/src/content/docs/` in the **same commit**, and
    registers a new page in `frontend/src/content/docs/sections.ts` when one is needed. `docs/plans/` is for
    builders, not a substitute. Do not mention plan phases in user docs, and never claim a feature exists that
    is not built.
14. **The product CLI tracks the operator HTTP surface.** A new action with a `web` route is a candidate for
    `cli/` (`botholomew <noun> <verb>`). In the same commit, either wrap it or decide it is out of scope — do
    not leave the question unasked. The CLI is a session HTTP client, the same surface as the website, not a
    wrapper around `bun keryx.ts`. Out of scope by default: task-only ticks, machine ingress, and anything a
    signed-in member would not click.
15. **The plans are kept current, and only half of each one is.** Everything above a phase doc's
    `## Learnings from the build` heading is the **plan** — a historical record of what was going to be
    built. Leave it alone even when it is wrong; a plan that says what it intended is doing its job, and
    editing it destroys the only account of why the shipped thing differs. The **learnings** section is the
    opposite — it describes what is true *now* — and so does every doc that is not a plan section: this file,
    the [plans index](./docs/plans/README.md), and anything else under `docs/` that describes the thing rather
    than the building of it. A change that makes any of those wrong fixes them **in the same commit**.

    Three ways this breaks: **a rename** (grep `docs/` and this file, not only the code), **a deleted test**
    (a learnings section calling an assertion load-bearing is wrong the moment it is gone), and **a superseded
    premise** (add a note and a translation table at the top of the section instead of rewriting it in
    place). Writing is the other half of the rule: when you learn something the code cannot say for itself,
    it goes in the relevant learnings section.
16. **A pull request is not the artifact.** A GitHub pull request, issue, or comment is for a human who
    already has the diff. Write it as short as it can be while still conveying the meaning you intend. Do not
    paste a file-by-file list or verification dumps into GitHub. Load-bearing argument belongs in a code
    comment or a learnings section, not in the PR body.

## Local development

> **Cloud agent VMs:** the startup caveats (how Postgres and Redis are started there, the `pg_hba.conf` trust
> setting, and how to run the app) will live in `docs/cloud-setup.md`, which phase 1 adds.

**Always use the system's Postgres and Redis — never Docker, and never Docker Compose.** Real services
everywhere: local, CI, and deployed. Docker is used only to build deployment images. Postgres needs the
**pgvector** extension.

```bash
brew services start postgresql@17 redis           # once per machine (plus: brew install pgvector)
createdb botholomew && createdb botholomew_test   # once per checkout

bun install
cd backend && cp .env.example .env
cd ../frontend && cp .env.example .env
```

One `.env` covers both development and test: `loadFromEnvIfSet` checks `${VAR}_${NODE_ENV}` before `${VAR}`,
so `DATABASE_URL_TEST` and `REDIS_URL_TEST` select themselves when `bun test` sets `NODE_ENV=test`.

**Be careful with native bindings.** A native addon that calls a libuv function Bun has not implemented on
POSIX panics uncatchably ([bun#18546](https://github.com/oven-sh/bun/issues/18546)). The root
`package.json`'s `trustedDependencies` **replaces** Bun's default trust list, so only the install scripts we
name run; `backend/__tests__/deps/native-addons.test.ts` asserts that. The local embedder and code mode are
WASM precisely so neither needs a native addon.

**Several checkouts at once:** `bun run workspace:setup` gives this worktree its own test database, Redis
index, and e2e ports, by writing them into `.env` once. Skipping it is the right answer for a single clone.

## Stack

| Layer | Choice |
|---|---|
| Runtime / language | Bun + TypeScript (strict). No `npm`/`npx` — use `bun`/`bunx` |
| Framework | Keryx `^0.48` |
| Database | Postgres 18 + **pgvector** via Drizzle ORM (`api.db.db`); migrations via `drizzle-kit`, owned by the worker |
| Cache / queue | Redis — sessions, rate limiting, `node-resque` tasks, PubSub, MCP session registry |
| LLM | Vercel AI SDK behind `backend/llm/`; Anthropic, OpenAI, OpenAI-compatible; BYOK |
| Embeddings | `bge-small-en-v1.5` (384-d) through transformers + onnxruntime-web WASM, in the worker |
| Code mode | Vercel's Run SDK (npm `run`; QuickJS via quickjs-wasi) with curated host functions |
| MCP client | `@modelcontextprotocol/sdk`; remote (HTTP / SSE) servers only — never stdio |
| Validation / lint | Zod v4; Biome (`bun run lint` = `tsc && biome check .`) |
| Frontend | Vite + React 19 + React Router 7 + local UI primitives + Tailwind CSS v4 + custom SCSS |
| CLI / TUI | Commander HTTP client (`botholomew`, alias `bothy`); Ink 7 + React 19 for `botholomew chat` |
| Monorepo | Bun workspaces: `backend/`, `frontend/`, `cli/` |
| Email | nodemailer over SMTP, arriving with notifications |
| Deploy | Render, one blueprint, staging only |

## Action conventions

One class per file, grouped in a domain folder (`actions/thread/thread-create.ts`). Actions are
auto-discovered by a recursive glob; files starting with `.` are skipped.

```ts
export class MessageSend extends AuditedAction {
  name = "message:send";                               // CLI: bun keryx.ts message:send --threadId 1
  description = "…";                                   // the MCP tool description the model reads
  mcp = { tool: true };                                // boot default; McpToolPolicyOps decides
  middleware = [RateLimitMiddleware, ProjectMemberMiddleware()];
  web = { route: "/message", method: HTTP_METHOD.PUT }; // PUT /api/message
  inputs = z.object({ /* Zod, every field .describe()d */ });
  async runWithAudit(tx, params, connection) { /* … */ }
}
```

- **HTTP verbs:** `PUT` = create, `GET` = read/list, `POST` = edit, `DELETE` = delete.
- **The product CLI (`cli/`, bin `botholomew`) wraps operator HTTP, not Keryx in-process.**
  `bun keryx.ts <action:name>` is the ops CLI (local Postgres, task ticks) and is not that surface.
- **Background jobs that delete things are sweepers (`*:sweep`), not cleaners or reapers.** `bots:reap` is
  different: it expires leases and settles stuck rows (status transitions); it does not purge.
- **Recurring and orchestration ticks are task-only — never give them a `web` route.** Anything with
  `task.frequency > 0` (dispatch, reap, schedule, retention sweeps, expiry, refresh) and its enqueued children
  (`bot:tick`) belong on the Resque worker or the ops CLI, not on the public API. `rbac.test.ts` asserts these
  have no `web.route`.
- **Keryx tasks are not durable on their own.** A one-off `enqueue` gets no lock, no dedupe, and no retry, and
  a crashed job is never retried. Single-flight comes from a Postgres lease, durability from a clock that
  reads the rows. `enqueueIn` / `enqueueAt` default to the `"default"` queue — always pass the queue. A task's
  connection carries no session, so every task re-authorizes from Postgres using ids in its params.
- **Responses are always a named object** (`{ bot }`, `{ threads, pagination }`), never a bare array.
- **Errors:** throw `TypedError({ message, type: ErrorType.* })`. Validation → 406, no session → 401,
  not found → 404, forbidden → 403, timeout → 408, rate limited → 429.
- **Use `CONNECTION_ACTION_PARAM_VALIDATION` for input validation, never `ACTION_VALIDATION`** — the latter
  maps to 500, because it categorizes an action *definition* being wrong at boot.
- **Anything a client must decide with, the server decides.** `project:view` returns
  `standing: { isMember, isAdmin }` and serializers mark reserved names, so no client compares a tag name to
  `"admin"`. Type-only imports are the contract; values cross the wire.
- **`ops/*.ts`** hold pure logic and `serializeX()` functions, which strip secrets and emit timestamps as
  epoch milliseconds. Actions and bot tools both call into `ops/`; neither calls the other.
- **`secret(z.string())`** marks a field for redaction in logs and audit metadata. Every action that accepts a
  credential uses it.
- **A URL somebody typed is fetched only through `assertPublicUrl`** (`ops/NetworkGuardOps.ts`), which
  resolves the name and refuses a private, loopback, link-local, reserved, or cloud-metadata address — at
  write time *and* immediately before every outbound request.
- **Config namespaces** extend the framework's via `declare module "keryx" { interface KeryxConfig { … } }`,
  built from `loadFromEnvIfSet`.
- **Side effects belong in `afterCommit`**, whose errors are logged and swallowed.
- **Redis Lua is a program in `backend/lua/*.lua`, never a string in TypeScript.**

## Schema conventions

`serial` primary keys, and **every timestamp column is `timestamp(..., { withTimezone: true })`**. That second
one is load-bearing, not style: a naked `timestamp` reads back hours off on any box that is not UTC, so
comparing it against an app-generated deadline misjudges expiry by that offset.

Every tenant row carries `projectId` with `onDelete: "cascade"`. Tables that break a rule do so on purpose,
and the plan that adds each one says why: `audit_logs` has no foreign key on `projectId` and no `updatedAt`, so
rows survive deletion; `memory_files` and `conversation_entries` are **append-only** — content is never
updated in place, a change is a new row.

## Tenancy and RBAC

A **project** is the tenant and the privacy boundary; an **organization** is a thin grouping above projects
and evaluates no permission of its own. Signup bootstraps a user into their own organization and project
inside one transaction. Two gates, no role ladder — `backend/middleware/rbac.ts` owns both, and `RBAC_LEVELS`
there is the single place the levels are enumerated:

| Level | Means | Middleware |
|---|---|---|
| `none` | no project-scoped gate (session-scoped or public) | — |
| `member` | holds a membership in `params.projectId` | `ProjectMemberMiddleware()` |
| `admin` | additionally holds the reserved `admin` tag | `AdminMiddleware()` |

`actions:permissions` (unauthenticated `GET /api/actions/permissions`) walks the registry and reports each
action's requirement, and the frontend's `can(permissions, actionName, standing)` is the only place it decides
what to show — so UI gating cannot drift from enforcement. `rbac.test.ts` fails if a new action accepts a
`projectId` without declaring a requirement.

Finer-grained than `admin` is a **tag**: project-scoped rows granted through `user_tags`, matched trimmed and
lowercased. Data-dependent access lives in the actions, not in middleware: `canReadBot` / `canWriteBot` gate a
bot (its threads, transcript, prompts, and approvals) from its `accessRead` / `accessWrite` tag lists, admins
always pass, and each shared MCP server's bot allowlist decides which bots may use it. There are no private
threads: anything said to a bot may surface to anyone who can read that bot.

## Audit logging

The audit row and the mutation it describes are **one commit**. `AuditedAction.run` opens the transaction,
calls the subclass's `runWithAudit(tx, …)`, and inserts the row on that same `tx`. There is no after-the-fact
writer, no queue, and no best-effort hook — the log cannot disagree with what was persisted, in either
direction.

`connection.metadata` is the channel for everything the row cannot infer: `auditProjectId` when the params do
not name a project, `auditTargetType` / `auditTargetPath` for the audit page's Target column, and
`auditMetadata` where `scrubParams(params)` would understate what happened. `writeAuditLog` is for changes made
inside a shared ops helper — which is how a bot's change to shared state is audited, with `actorBotId` set.

## Architecture

**The map is the [plans index](./docs/plans/README.md#core-architecture)**, and the bot loop's full account is
[phase 6](./docs/plans/phase-06-durable-bot-loop.md). What follows is only the part that is a **rule** while
writing code.

- **All of a bot's state is in Postgres, and nothing holds it in memory.** A conversation outlives deploys,
  worker restarts, and OOM kills. Every transition is a row change; a WebSocket frame is an accelerant and a
  reconnect re-reads, because Postgres is the source of truth.
- **A conversation is the unit of context and of the lease.** A conversation is one bot in one thread. A
  `bot:tick` holds that conversation's lease, bumps `leaseEpoch` when it takes it, and fences **every** write
  — the release included — with `WHERE leaseEpoch = $mine`. A write that does not carry the fence is a bug
  even when the tests pass.
- **Commit intent, perform the effect, commit the outcome.** A model call is a `model_steps` row before the
  request; a tool call is a `tool_calls` row before it runs. A tool declares `replay: "safe" | "unsafe"`, and an
  unsafe call found `started` after a crash becomes an "outcome unknown" result for the model — it is never
  re-run blindly.
- **One output channel.** Only the text of a turn's final, tool-free step is posted to the thread; interim
  text is transcript-only, and `send_message` reaches anywhere else.
- **Content from outside is data, not instructions.** MCP output, fetched pages, other people's messages, and
  bot-to-bot text are fenced with their provenance before they reach a model.
- **Every "cheap early out" above a `SELECT … FOR UPDATE` is exactly that.** The lock is the guard; the early
  out is an optimization and may never be the only check.
- **Project memory is the project's filesystem.** Prompts (`bots/<slug>/prompts/`, `prompts/`) and skills
  (`skills/`) are memory files; writes to those reserved paths are validated against strict frontmatter
  schemas, and a bot may edit its own prompts only where `agent-modification: true`.
- **Every component type is a registry-backed DSL** — one `kind` string keying a map, prose for a human, and
  a Zod schema that validates the `jsonb` config and generates the editor's form. Adding a member is one file
  plus one registry entry, and no frontend code names a member.

## Frontend conventions

**Types come from the backend with no codegen.** Import the action class through the `@backend/*` alias and
derive its response — never hand-write an interface mirroring `run()`'s return value:

```ts
import type { Status } from "@backend/actions/status";
import type { ActionResponse } from "keryx";

type StatusResponse = ActionResponse<Status>;
```

The alias is configured in two places that must stay in sync: `resolve.alias` in `frontend/vite.config.ts` and
`compilerOptions.paths` in `frontend/tsconfig.app.json`. `erasableSyntaxOnly` is deliberately **off**:
resolving backend types pulls in Keryx's source, which uses enums.

- All HTTP goes through `apiFetch` in `frontend/src/utils/client.ts`, which prefixes `/api`, sends
  `credentials: "include"`, and throws on Keryx's `{ error: { message } }` envelope — an envelope Keryx can
  return alongside a 200, so check the envelope, not the status.
- `AuthContext` is the one place session state lives; `ProtectedRoute` is the one place a signed-out or
  project-less visitor's destination is decided.
- Gate controls with `can(permissions, "action:name", standing)`, never by restating a rule.
- **An unresolved standing may hide an affordance; it must never render a denial.** Spell the null branch out
  — `standing !== null && can(…)` — and leave `can()`'s parameter non-nullable.
- **Loading is three states, not two** — `frontend/src/hooks/useFirstLoad.ts`. `loading` is *before the first
  answer* and is the only state a skeleton or an empty-state sentence may depend on; `reloading` may only add
  an inline mark; a live refresh asks for neither.
- **A form is never rendered from a seed built out of `null`.** Withhold the form until the server has
  answered.
- **A section owns its own draft, its own busy state, and its own alerts** — `components/sections/`
  (`SectionCard`, `SectionNav`, `useSeededDraft`, `useSectionSave`, `useDirtyGuard`). No section may write
  `useEffect(() => setX(detail.x), [detail])`.
- Controls that need a session or a saved row are **disabled, never absent**, so one e2e selector resolves in
  both states.
- **A loader gates every write on the subject it started for.** A page keyed on a route param stays mounted
  when the param changes; a late answer for the thread you left must not paint the thread you opened.
- **Live pages follow WebSockets, keyed on the last row id.** A content-free frame names which endpoints to
  re-read; a reconnect hydrates ("subscribe, then hydrate"). There is no `setInterval` on the frontend.
- **Model-authored prose renders through `components/MarkdownBlock.tsx`, and nothing else imports
  `react-markdown`.** There is no `rehype-raw`, and that is the whole reason it is safe to put a bot's output
  in the DOM.
- **User-facing documentation is markdown under `frontend/src/content/docs/`**, rendered at public `/docs`
  through `pages/docs/` and the `DOCS_SECTIONS` table. Do not restate docs as TSX prose.
- `Button as={Link}` does not type-check; use a `Link` wearing `className="btn btn-…"`.

## Frontend styling

Reusable controls live under `frontend/src/ui/`; product-specific layout belongs to semantic component
classes, and Tailwind CSS v4 is available without Preflight. Runtime tokens live in
`styles/themes/_tokens.scss`, and every general-page size is `calc(var(--tx-font-size) * n)` — a literal `rem`
font-size in a general-page rule is a bug. A `variant` the stylesheet does not paint is painted wrong: a new
tone is a name in `UI_VARIANT_TONES` **and** a rule in `_ui.scss`. A component that renders at two very
different widths asks its own box (a container query), not the viewport.

## Testing

**Run tests locally for the areas your change touches; rely on CI for the full suites.** A targeted backend
file or folder (`cd backend && bun test path/to/foo.test.ts`), the frontend unit tests, or an e2e spec is
enough for most edits. CI runs the complete backend, frontend, CLI, build, Docker, and e2e matrix on every
push.

Backend tests boot a real server and drive it over HTTP. `WEB_SERVER_PORT_TEST=0` gives every test file its
own random free port; `backend/__tests__/setup.ts` is preloaded via `backend/bunfig.toml`; use `serverUrl()`
for the bound URL and `HOOK_TIMEOUT` for `beforeAll` / `afterAll`.

- **Seed with `buildTestUniverse()`**, which casts a fixed team so a test reads as a sentence: Peach
  administers the shared project, Mario holds `operators`, Luigi holds `viewers`, Toad is a member with no
  tags, and **Bowser is an outsider with no membership**. Members join through the **real** invite → accept
  HTTP flow. `getMcpAccessToken()` drives the full OAuth + PKCE flow for MCP tests.
- **Third parties are servers, not mocks.** The fake model provider scripts responses — text, tool calls,
  delays, and mid-stream failures — so the bot loop is exercised end to end; the fake MCP, Slack, and Linq
  servers do the same for theirs; the fake embedder is deterministic.
- **Run task actions in-process** with `runAction(name, params)` and drain queues with `drainTasks(queue)`; a
  test never waits for a clock to fire.
- **Control time by writing columns, never by waiting** — `leaseExpiresAt`, `wakeAt`, `expiresAt`.
- **Concurrency tests fire `cap * 4` and drop limits to 0**, both measured rather than chosen.
- **Assert the property, not the symptom.** The load-bearing assertions are equalities and whole-set
  comparisons: two 404 bodies being byte-identical, a broadcast frame's key set being exactly two keys, a
  fenced write affecting exactly zero rows.
- Deployment config is tested too: `render-blueprint.test.ts` parses the real `render.yaml` and asserts its
  invariants. `docs/links.test.ts` is the same idea pointed at the documentation — every relative link in this
  file, the root `README.md`, and `docs/**` must resolve, and every plan doc keeps its
  `## Learnings from the build` heading.
- **Behaviour evals are not tests.** A nightly harness drives bots against a real model and scores scenarios;
  it never gates CI.

Each plan doc's **Learnings from the build** section says what its own suite covers and why it stops where it
does.

## Deployment

One `render.yaml` at the repo root: `botholomew-api` + `botholomew-worker` (same `backend/Dockerfile`,
differing only by env) + `botholomew-frontend` + `botholomew-redis` + `botholomew-db` (Postgres with
pgvector), staging only, auto-deployed on merge to `main`. **The worker owns migrations** so the web service
never races a schema change. Values that must be byte-identical across web and worker —
`SECRETS_ENCRYPTION_KEY` above all — live in the `botholomew-shared` env var group. The runbook will be
`docs/DEPLOY.md`; the blueprint's invariants are in [phase 2](./docs/plans/phase-02-deployment.md).

## CI

Parallel jobs plus a **"CI Complete"** gate, which is the single required status check on `main` — so adding a
job never requires touching branch protection. The gate reads `toJSON(needs)` and asserts every result **is**
`success`, rather than listing the results that are not: a denylist of outcomes fails open the day the
platform invents one.

| Job | Covers |
|---|---|
| Backend Lint / Frontend Lint / CLI Lint | `tsc` + Biome per workspace. CLI Lint also runs `cli/` unit tests |
| Backend Test | Real server over HTTP against service-container Postgres (`pgvector/pgvector:pg18`) + Redis. Includes CLI spawn-the-binary tests |
| Frontend Test | Unit tests under `src/__tests__`, then a production build as a workflow step |
| Frontend Build | `tsc -b && vite build`, which proves the `@backend/*` alias resolves |
| Backend Docker / Frontend Docker | Both images build from the repo root |
| E2E Test | Playwright drives a real browser against the real backend and the fake model provider |

Publishing (the CLI to npm, compiled binaries to releases) lives in **separate workflows** outside `ci.yml`
and its gate: a publish is not a check, and a push-only job inside the gate would report `skipped` on every PR
and fail the one required check.

## Commands

```bash
bun install                                      # root (workspaces)
bun dev                                          # backend on :8080, frontend on :3000
bun run lint                                     # tsc + biome, backend + frontend + cli
bun run test                                     # backend + frontend + cli — `bun test` at the root shadows the
                                                 # script with Bun's own runner, missing backend/bunfig.toml

bun run workspace:setup                          # optional: this checkout's own test DB, Redis index, ports
cd backend  && bun run migrations && bun test    # real server over HTTP, isolated test DB
cd frontend && bun run test:e2e                  # Playwright, on this checkout's own ports
CI=true bun run test:e2e                         # ...as CI runs it: fresh servers, no reuse
bun run --cwd cli botholomew --help              # product CLI (HTTP client)
bun run --cwd cli botholomew login --url http://localhost:8080

open http://localhost:3000/docs                  # user-facing docs (public)
open http://localhost:3000/settings              # project settings; every section is its own URL
curl localhost:8080/api/actions/permissions      # every action's RBAC level, no auth needed

# Orchestration ticks are task-only — see Action conventions above. Invoke by hand via:
#   cd backend && bun keryx.ts bots:dispatch
# (same for bots:reap and every *:sweep)

cd backend && bun run db:repair-sequences        # after restoring a dump: reconcile every serial sequence
```

Per-feature recipes live in the **Commands** block of the matching plan doc.

## Where the detail lives

| Topic | Doc |
|---|---|
| The roadmap, the data model, the core architecture, the settled stack | [`docs/plans/README.md`](./docs/plans/README.md) |
| The clean break from v1, the copied platform shell, the test harness, the CI gate | [`phase-01-clean-slate-and-shell.md`](./docs/plans/phase-01-clean-slate-and-shell.md) |
| The Render blueprint and its invariants | [`phase-02-deployment.md`](./docs/plans/phase-02-deployment.md) |
| Organizations above projects | [`phase-03-organizations.md`](./docs/plans/phase-03-organizations.md) |
| Project memory as a versioned filesystem; reserved paths; the membot feature map | [`phase-04-project-memory-core.md`](./docs/plans/phase-04-project-memory-core.md) |
| Bots, prompts as files, BYOK connections, the named model registry | [`phase-05-bots.md`](./docs/plans/phase-05-bots.md) |
| Conversations, leases, the tick state machine, the effect sandwich, guards, `backend/llm/` | [`phase-06-durable-bot-loop.md`](./docs/plans/phase-06-durable-bot-loop.md) |
| Threads, routing and mentions, live channels, notifications, the chat UI | [`phase-07-threads-and-web-chat.md`](./docs/plans/phase-07-threads-and-web-chat.md) |
| Compaction, resets, large results, thread search, prompt-cache discipline | [`phase-08-context-management.md`](./docs/plans/phase-08-context-management.md) |
| Embeddings, hybrid search, converters, uploads | [`phase-09-memory-search-and-ingestion.md`](./docs/plans/phase-09-memory-search-and-ingestion.md) |
| Shared MCP servers, gateway OAuth, MCP meta-tools, the approval gate | [`phase-10-mcp-servers-and-approvals.md`](./docs/plans/phase-10-mcp-servers-and-approvals.md) |
| Code mode: QuickJS in WASM, host functions, encrypted continuations | [`phase-11-code-mode.md`](./docs/plans/phase-11-code-mode.md) |
| Skills: slash commands for people, `skill_read` for bots | [`phase-12-skills.md`](./docs/plans/phase-12-skills.md) |
| Leader and workers: delegation, task DAGs, reporting, swarm guards | [`phase-13-leader-and-workers.md`](./docs/plans/phase-13-leader-and-workers.md) |
| Schedules, durable wakeups, webhook triggers | [`phase-14-schedules-and-wakeups.md`](./docs/plans/phase-14-schedules-and-wakeups.md) |
| `botholomew chat`, CLI publishing, binaries | [`phase-15-tui-and-cli-publishing.md`](./docs/plans/phase-15-tui-and-cli-publishing.md) |
| Slack: linked identities, threads, outbox, approval cards | [`phase-16-slack.md`](./docs/plans/phase-16-slack.md) |
| iMessage through Linq: reach, opt-out, reply threading | [`phase-17-imessage.md`](./docs/plans/phase-17-imessage.md) |
| Retention, deletion, key rotation, usage dashboards, evals | [`phase-18-operations.md`](./docs/plans/phase-18-operations.md) |
| Adding memory from a URL | [`phase-19-url-ingest.md`](./docs/plans/phase-19-url-ingest.md) |
| Refreshing upstream content on a cadence | [`phase-20-upstream-refresh.md`](./docs/plans/phase-20-upstream-refresh.md) |
| MCP-backed source routers and bulk sync | [`phase-21-source-routers-and-bulk-sync.md`](./docs/plans/phase-21-source-routers-and-bulk-sync.md) |
| LLM-assisted ingestion: captions, conversion fallback, descriptions | [`phase-22-llm-assisted-ingestion.md`](./docs/plans/phase-22-llm-assisted-ingestion.md) |
| Original bytes and the blob policy | [`phase-23-original-bytes-and-blob-policy.md`](./docs/plans/phase-23-original-bytes-and-blob-policy.md) |
