# Phase 5 — Bots: identity, prompts, goals, models

> **Goal:** Every project has a roster — the seeded leader, Botholomew, plus any worker bots people define —
> each with a name, a role, a routing description, access tags, a model, a budget, and a concurrency cap, and
> each with its identity, goals, and beliefs as versioned files in project memory. The project connects its
> own model providers and names the models its bots use. Nothing runs yet.

> **Status: planned, not built.** Stage B — One bot that thinks. Depends on
> [phase 1](./phase-0001-clean-slate-and-shell.md), [phase 3](./phase-0003-organizations.md), and
> [phase 4](./phase-0004-project-memory-core.md).

[Phase 6](./phase-0006-durable-bot-loop.md) cannot take a single model step without four things: a bot, the
prompt it sees, a model to call, and a key to call it with. This phase builds all four and stops there, the
way ToolExec's agent-management phase defined agents before any run existed. The editor, the access rules,
model resolution, and prompt assembly can be reviewed — and tested — with no loop in the way.

The `bots` table holds **structured fields only**. Everything a bot is told — identity, goals, beliefs, any
other instruction — is a file under `bots/<slug>/prompts/`, beside the project-wide `prompts/`. v1 already
kept prompts as markdown with strict frontmatter; putting them in project memory gives them history, diff,
restore, search, the editor, and the CLI for free, and lets a bot edit its own goals in phase 6 through the
same tools and rules a person uses. Keys are the project's own (**BYOK only**): connections are ported from
ToolExec, and the named model registry from v1.

Deliberately out: anything that calls a model except a connection probe, status transitions, budget
enforcement, and everything a bot *does*. Those are phase 6 onward.

## Scope

**In:** the `bots` table (name, slug, avatar, `leader | worker` role with one leader per project, routing
description, model pin, `accessRead` / `accessWrite`, enabled, a monthly budget, a concurrency cap);
`BotOps` (access checks, slugs, rename with a namespace move, leader swap, seeding); `canWriteBot` replacing
phase 4's refusal on `bots/**`; prompt loading and cache-stable assembly with `bot:prompt-preview`;
`bot:validate`; `project_connections` with `CryptoOps` and kinds `anthropic | openai | openai_compatible`,
plus `connection:probe`; the `project_models` registry with a default and a fast model and v1's resolution
rules, plus `model:options`; seeding the leader at project creation and backfilling existing projects; RBAC;
audit; the Bots pages and editor; Settings → Connections and Models; `botholomew bot`, `connection`, and
`model`; user docs; tests.

**Out:** model calls, the loop, `bots.status` and the pause columns (reserved for phase 6, which adds and
derives them), budget enforcement and the usage ledger
([phase 6](./phase-0006-durable-bot-loop.md)); thread ownership and routing by description
([phase 7](./phase-0007-threads-and-web-chat.md)); per-bot MCP allowlists
([phase 10](./phase-0010-mcp-servers-and-approvals.md)); skills in the prompt
([phase 12](./phase-0012-skills.md)); the leader creating and hibernating workers
([phase 13](./phase-0013-leader-and-workers.md)); per-bot schedules
([phase 14](./phase-0014-schedules-and-wakeups.md)); uploaded avatar images and bot templates (later).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| ToolExec's `agents` table | `description` as the text a model chooses by, `accessRead` / `accessWrite` tag lists with `ACCESS_EVERYONE`, the per-project slug index, and why `MIN_AGENT_DESCRIPTION_LENGTH` is reported by validate rather than refused on create | `toolexec:backend/schema/agents.ts` |
| `satisfiesAccess`, `canReadAgent`, `canWriteAgent`, `readableAgentIds`, `generateAgentSlug` | The access rule (admins pass; `*` or an empty list is everyone; case-insensitive tags) and slug generation, ported as-is | `toolexec:backend/ops/AgentOps.ts` |
| `project_connections`, `ConnectionOps`, `CryptoOps` | AES-256-GCM ciphertext triple, `lastFour`, per-kind strict metadata, the boot-time key check, no plaintext fallback | `toolexec:backend/schema/project_connections.ts`, `toolexec:backend/ops/ConnectionOps.ts`, `toolexec:backend/ops/CryptoOps.ts` |
| Connection registry and probe | Per-kind definitions; a probe that never throws, never writes, never leaks | `toolexec:backend/connections/registry.ts`, `toolexec:backend/ops/ConnectionProbeOps.ts` |
| `connection:put` | `secret()` params, `SENSITIVE_KEYS` scrubbing, serialized-only audit | `toolexec:backend/actions/connection/connection-put.ts` |
| Model suggestions | Provider model lists as authoring help, never as validation | `toolexec:backend/ops/AgentModelOptionsOps.ts` |
| SSRF guard | `assertPublicUrl` for a typed-in base URL | `toolexec:backend/ops/NetworkGuardOps.ts` |
| Editor and settings UI | Agent editor panels, connection form, probe report, model section | `toolexec:frontend/src/pages/AgentEditorPage.tsx`, `toolexec:frontend/src/components/settings/ConnectionForm.tsx`, `toolexec:frontend/src/components/settings/ProbeReport.tsx`, `toolexec:frontend/src/components/settings/sections/ModelSection.tsx` |
| Named models | `resolveModel`, `resolveModelFor` (`--model` > pin > default, with `shadowed`), `resolveFastModel`, and error text that lists the available names | [src/config/models.ts](https://github.com/evantahler/botholomew/blob/v1/src/config/models.ts), [milestone-17](https://github.com/evantahler/botholomew/blob/v1/docs/plans/milestone-17-named-models.md) |
| Prompt loading | `loadPersistentContext` (`always` vs keyword-matched `contextual`), `extractKeywords`, and the bug to fix: `buildMetaHeader` puts a millisecond timestamp at the top of every system prompt | [src/worker/prompt.ts](https://github.com/evantahler/botholomew/blob/v1/src/worker/prompt.ts), [src/chat/agent.ts](https://github.com/evantahler/botholomew/blob/v1/src/chat/agent.ts) |
| The owl | `GOALS_MD` / `BELIEFS_MD` seed text and the persona reference | [src/init/templates.ts](https://github.com/evantahler/botholomew/blob/v1/src/init/templates.ts), [docs/owl-character-sheet.md](https://github.com/evantahler/botholomew/blob/v1/docs/owl-character-sheet.md) |
| Project memory | `MemoryOps`, the namespace registry with its bot seams, strict prompt frontmatter, the editor | [phase 4](./phase-0004-project-memory-core.md) |

## What this must not weaken

1. **BYOK only.** The platform holds no model key and has no fallback key. A project with no connection can
   define bots, and [phase 6](./phase-0006-durable-bot-loop.md) refuses to run them with a hint.
2. **A credential's plaintext lives only in server memory, at the moment of use.** It is never returned,
   logged, audited (only `lastFour`), placed in a prompt, or reachable from a bot tool or
   [code mode](./phase-0011-code-mode.md).
3. **The project is the boundary.** A bot pins only its own project's models; a model uses only its own
   project's connection, checked on write.
4. **Data-dependent access is enforced in the action** (`canReadBot` / `canWriteBot`); middleware gates
   membership and admin only, because it runs before the row is loaded.
5. **Every human decision is audited**, and no audit row carries a secret.
6. **Prompts are files.** There is no prompt column; one source of truth, with history.
7. **Exactly one leader per project, always.**
8. **Models are resolved at boundaries**, through `ModelOps`; nothing indexes the registry directly.
9. **A typed-in base URL passes the SSRF guard on write and before every use**, and a key is never sent
   across a redirect.

## Design

### A bot is a row plus a directory

The row is what code reasons about: identity for URLs and mentions (`slug`), role, access, model pin,
limits. The directory is what a model reads: `bots/<slug>/prompts/` (seeded with `identity.md`, `goals.md`,
`beliefs.md`) and `bots/<slug>/notes/` (the bot's working notes, empty until it writes). Phase 4's namespace
registry already knows both shapes; this phase fills its seam: `resolveBotNamespace(projectId, slug)` now
finds the bot, and the human rule for `bots/<slug>/**` becomes `canWriteBot`. A write under a slug with no bot
is refused — namespaces are created by their bot, never by a stray path.

### Leader and workers

`role` is `leader | worker`, and a partial unique index on `(projectId) WHERE role = 'leader'` makes "one
leader" structural. Being the leader is a convention, not a feature (Grok Bot's framing): the leader becomes
the default owner of new threads in [phase 7](./phase-0007-threads-and-web-chat.md) and watches workers in
[phase 13](./phase-0013-leader-and-workers.md); in this phase it differs only by role and seed. The leader
cannot be deleted or demoted by `bot:edit`. `bot:make-leader` (admin) demotes the old leader and promotes the
new one in one transaction, two statements in that order — a unique index is checked per row, so a single
swapping `UPDATE` could trip it.

### Description is the routing signal

As in ToolExec, `description` is not documentation: it is what the leader and `@everyone` routing will read
to decide who should take a message. A bot described as "research" is a bot nothing routes to correctly.
`bot:create` accepts an empty description so a first save is just a name; `bot:validate` reports anything
under 20 characters, alongside a dangling model pin, a project with no default model or no usable connection,
and any prompt file that would fail to load — all problems at once, not one per round trip.

### Who may see and change a bot

`canReadBot` / `canWriteBot` are ToolExec's `satisfiesAccess` unchanged. Read means seeing the bot and (from
phase 7) its threads; write means editing it, editing its prompt files, messaging it, and answering its
approvals. One honesty note, stated in the user docs: a bot's *files* are project memory, readable by every
member regardless of `accessRead`. The project is the privacy boundary; separate bots are not one, which is
exactly how Grok Bot's docs put it.

### Prompts are files, assembled in a cache-stable order

`BotPromptOps.loadPromptFiles` reads the current heads under `prompts/` and `bots/<slug>/prompts/` in one
query and parses each with phase 4's strict schema. As in v1, a file that fails **fast-fails** the load,
naming the path; phase 4 validates on write, so this only fires if a schema tightens later.

v1 built the system prompt as `buildMetaHeader` + prompts + instructions, and the header's first lines were
`Current time (UTC): <ISO with milliseconds>`. Every request therefore had a unique first line and the
provider's prompt cache could never hit — the most expensive line in the codebase. `buildPromptLayers(bot,
{ triggerText })` fixes that by construction:

| Order | Layer | Changes when |
|---|---|---|
| 1 | Phase 6's fixed sections — platform identity, the one output channel, fencing, v1's `STYLE_RULES` — and the generated tool section. Written there; the preview shows them as placeholders | A deploy |
| 2 | `bots/<slug>/prompts/identity.md` | A person edits it (`agent-modification: false` by default) |
| 3 | Project `prompts/*.md` with `loading: always`, by path | An admin edits one |
| 4 | The bot's other `always` prompts, by path | Rarely |
| 5 | `goals.md`, then `beliefs.md` | The bot edits itself — the most frequent change, so it goes last |
| — | **cache breakpoint** | |
| 6 | `contextual` prompts matched to the trigger text | Every message |

Ordering by volatility means a bot's self-edit to `beliefs.md` invalidates only the tail of the cached
prefix. No layer above the breakpoint contains a timestamp, a counter, or anything per-request. Layers 2–5
are what phase 6 hashes into its `system` entry; layer 6, the current time, and the other per-turn facts go
into the turn's volatile tail, after the breakpoints. Contextual matching ports `extractKeywords` (lowercased, whitespace-split, longer than three
characters) and adds a stopword list — v1's matched "that" and "with" — then ranks files by overlap and caps
the set at 5 files and 16,000 characters. The result carries every layer's `logicalPath` and `versionId`, so
phase 6 can record exactly which prompt versions the model saw.

`bot:prompt-preview` renders this for a person: the stable layers, where the breakpoint falls, which
contextual files a sample message would pull in, and sizes in characters and estimated tokens. v1's
auto-generated `capabilities.md` is not carried over — 2.0's tool list is generated from the registry at
request time, so there is nothing to regenerate.

### The leader is seeded with the owl

`createProjectForOwner` gains `createLeader(tx, project, user)`, in the same transaction as the project,
membership, and admin tag — a project without its leader is a broken project, so it is never created in
pieces. The leader is `Botholomew`, slug `botholomew`, an owl avatar, access `["*"]`, no model pin, and a
description that says it is the project's lead bot and default point of contact. Its files are written
through `MemoryOps` as create-only versions authored by the signing-up user (`operation: create`, change note
"Seeded with the project"), derived from v1's templates:

- `identity.md` (`always`, `agent-modification: false`): the persona paragraphs of `GOALS_MD` — a wise owl,
  thoughtful and thorough, direct, never flattering — rewritten to "the lead bot of this project".
- `goals.md` (`always`, `true`): `GOALS_MD`'s goal list ("Get set up and ready to help").
- `beliefs.md` (`always`, `true`): `BELIEFS_MD`.

Splitting identity out of v1's `goals.md` is deliberate: goals and beliefs are the bot's to evolve, while
who it is stays a human decision. A worker created by `bot:create` gets the same three files from a generic
template built from its name and description. Projects created before this phase get their leader from
`bots:ensure-leaders`, an idempotent clock.

### Renaming a slug moves its namespace

`bot:edit` with a new slug runs, in one transaction: uniqueness check, phase 4's `movePrefix` from
`bots/<old>/` to `bots/<new>/` (every live file gets a `move` version with lineage, the old paths are
tombstoned), the row update, one audit row whose metadata counts the moved files, and frames after commit.
Text inside files that mentions the old path is not rewritten; the docs say so. Deleting a bot (never the
leader) tombstones its namespace — history stays — and deletes the row.

### Connections: the project's own keys

`project_connections` keeps ToolExec's shape and promises — ciphertext triple under
`SECRETS_ENCRYPTION_KEY`, `lastFour`, strict per-kind `metadata`, a probe that never throws, writes, or
leaks — with two changes. The kinds are `anthropic | openai | openai_compatible`, all `api_key`, so the
OAuth refresh columns go. And connections are **named**, unique per project, instead of one per kind: a team
may want two Anthropic keys billed separately, and `openai_compatible` is plural by nature. ToolExec's "no
free-text names" rule existed so an agent's config could not ask a sandbox for a credential by name; here no
guest code exists, and a model entry references its connection by foreign key, never by a name a bot can
type.

`openai_compatible` requires `metadata.baseUrl`, `https` and public (`assertPublicUrl`) on write and before
each call; development allows private hosts, as ToolExec does. v1's Ollama provider is not a kind — a hosted
service cannot reach a laptop, and a public Ollama speaks the OpenAI-compatible API. Every outbound call that
carries a key uses `redirect: "manual"` and treats a 3xx as an error: following a redirect would hand the key
to whatever host the redirect names. `connection:put` is **never an MCP tool** — pasting a key through an MCP
client puts the plaintext into a third party's model context and transcript; the web form and the CLI (which
reads the key from stdin or a hidden prompt, never an argument) are the only ways in.

### Named models

`project_models` is v1's registry as rows: a name, a connection, the provider's model id, `maxInputTokens`
(0 = look up), `supportsTools` (honored only for `openai_compatible`, as in v1), and strict per-kind
`providerOptions`. One model may be the project default and one the fast model, each enforced by a partial
unique index. `ModelOps` ports v1's functions over the rows:

- `resolveModel(projectId, name?)` — a name, else the default; a miss lists the available names.
- `resolveModelFor(projectId, { override, pinned })` — `override` (a per-turn `--model`) beats `pinned` (the
  most specific pin: a task's or schedule's, else the bot's `modelName`) beats the default, and returns
  `shadowed` when the override displaces a pin, so the override is logged rather than silent.
- `resolveFastModel(projectId)` — the fast model, **else the default**. v1 required both; a fresh 2.0
  project with a single key should not need two registry entries before it can title a thread.

Resolution happens at boundaries — phase 6 resolves once per turn, before any `model_steps` row exists — so
an unknown name fails before anything is spent. `bots.modelName` pins by name, as v1's task `model:` did;
renaming a model rewrites its pins in the same transaction, and deleting a model is refused while it is the
default, the fast model, or anyone's pin.

### Declared now, used later

`concurrencyCap` (default 3, at least 1) and `monthlyBudgetUsd` are enforced by
[phase 6](./phase-0006-durable-bot-loop.md): with a cap of 2 or more, one slot is held back for human-priority
work, and the budget is checked against the month's `usage_events` before each model step. Declaring them now
keeps the editor complete and avoids a migration against a table that will have rows; the schema comment says
what reads each one. `bots.status` (`hibernating | working | waiting | paused | errored`) is reserved for
phase 6, which adds it with the pause columns and derives it from conversations; nothing in this phase shows a
status, because nothing here could make one true.

## Steps

### 1. Schema — `backend/schema/{bots,project_connections,project_models}.ts`

`bots`:

| Column | Type | Notes |
|---|---|---|
| `projectId` | `integer` | cascade |
| `name` / `slug` | `varchar(256)` / `varchar(48)` | `uniqueIndex(projectId, slug)`; slug `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `role` | `varchar(16)` | `leader \| worker`; `uniqueIndex(projectId) WHERE role = 'leader'` |
| `description` | `text` | May be `""`; validate reports under 20 characters |
| `avatarGlyph`, `avatarColor` | `varchar(16)` | A glyph and a theme palette token; no image upload |
| `modelName` | `varchar(64)` | Nullable pin; null means the project default |
| `accessRead`, `accessWrite` | `jsonb string[]` | Default `["*"]` |
| `enabled` | `boolean` | Default `true` |
| `concurrencyCap` | `integer` | Default 3, `CHECK (>= 1)`; read by phase 6's lease acquisition |
| `monthlyBudgetUsd` | `numeric(12,2)` | Nullable = no bot-level cap; read by phase 6's budget guard |
| `createdBy` | → `users.id` | `set null` |

`project_connections`: `projectId` (cascade), `name` (`uniqueIndex(projectId, name)`), `kind`, `authMode`
(`api_key`), `ciphertext` / `iv` / `authTag`, `metadata jsonb`, `lastFour`, `lastUsedAt`, `createdBy`,
timestamps. `project_models`: `projectId` (cascade), `name` (`uniqueIndex(projectId, name)`),
`connectionId` (→ `project_connections.id`, **restrict**), `providerModel`, `maxInputTokens`,
`maxOutputTokens`, `supportsTools`, `providerOptions jsonb`, `isDefault`, `isFast` (each with a partial
unique index on `projectId`), `createdBy`, timestamps. Also: `memory_files.authorBotId` gains its foreign key
(`set null`).

### 2. Ops — `backend/ops/{BotOps,BotPromptOps,ConnectionOps,ConnectionProbeOps,ModelOps}.ts`

- `BotOps`: `serializeBot`, `canReadBot`, `canWriteBot`, `readableBotIds`, `generateBotSlug` /
  `uniqueBotSlug`, `createBot(tx, …)` (row + seeded files), `createLeader`, `renameBotSlug`, `makeLeader`,
  `deleteBot`, `validateBot` → `{ ok, problems: { field, message, severity }[] }`.
- `BotPromptOps`: `loadPromptFiles`, `buildPromptLayers` → `{ stable, contextual, versionIds }`,
  `renderPromptPreview`, the seed templates.
- `ConnectionOps` (ported): `serializeConnection` (never a secret field), `putConnection`, `deleteConnection`
  (refused while a model references it), `connectionKey(connectionId)` — the one decrypt, called only by
  `backend/llm/` from phase 6 and by probes.
- `ConnectionProbeOps`: `probeConnection(projectId, connectionId)` — `GET /v1/models` (or `${baseUrl}/models`),
  10 s deadline, `redirect: "manual"`, result scrubbed of the key.
- `ModelOps`: `listModelNames`, `resolveModel`, `resolveModelFor`, `resolveFastModel`,
  `modelOptions(connectionId)` (ToolExec's suggestion helper, never throws).

### 3. Actions — `backend/actions/{bot,connection,model}/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `bot:create` | `PUT /bot` | member | yes | yes |
| `bot:view` / `bot:list` | `GET /bot` / `GET /bots` | member + `canReadBot` (list filtered, paginated) | — | yes |
| `bot:edit` | `POST /bot` | member + `canWriteBot` | yes | yes |
| `bot:delete` | `DELETE /bot` | member + `canWriteBot`; leader refused | yes | yes |
| `bot:make-leader` | `POST /bot/leader` | `AdminMiddleware()` | yes | yes |
| `bot:validate` / `bot:prompt-preview` | `GET /bot/validate` / `GET /bot/prompt-preview` | member + `canReadBot` | — | yes |
| `connection:put` | `PUT /connection` | `AdminMiddleware()`; key is `secret()` | yes (serialized only) | **never** |
| `connection:list` | `GET /connections` | member | — | yes |
| `connection:delete` | `DELETE /connection` | `AdminMiddleware()` | yes | yes |
| `connection:probe` | `POST /connection/probe` | `AdminMiddleware()` | — (a diagnostic that writes nothing) | yes |
| `model:create` / `model:edit` / `model:delete` | `PUT` / `POST` / `DELETE /model` | `AdminMiddleware()` | yes | yes |
| `model:list` | `GET /models` | member | — | yes |
| `model:options` | `GET /model/options` | `AdminMiddleware()` | — | yes |

`connection:put` joins the closed never-MCP list in `McpToolPolicyOps`, with the reason in its comment;
`rbac.test.ts` asserts it. Model definition is admin-only because a model entry decides whose key every bot
in the project spends.

### 4. Clocks — `backend/actions/bot/bots-ensure-leaders.ts`

`bots:ensure-leaders`: task-only, `frequency` daily and enqueued once at worker boot, `mcp = { tool: false }`.
Creates a leader for any project lacking one, under a per-project advisory lock; idempotent.

### 5. Frontend — `frontend/src/pages/{BotsPage,BotPage,NewBotPage}.tsx`, settings sections

- `BotsPage` (`/bots`): a card per readable bot — avatar, name, leader badge, description, resolved model,
  enabled.
- `BotPage` (`/bots/:slug`): **Overview** (name, slug, description, avatar, model pin, access tag
  multi-selects with an explicit "everyone", enabled, concurrency cap, monthly budget, and a Validate button that
  lists every problem); **Prompts** and **Notes** (phase 4's tree and editor rooted at the bot's directories,
  with project-wide prompts linked read-only for non-admins); **Prompt preview** (layers, the breakpoint, and
  a sample-message box showing which contextual files would load).
- Settings: `ConnectionsSection` (ToolExec's form and probe report, with the kind's base-URL field) and
  `ModelsSection` (the registry, default and fast radios, "add model" with provider suggestions).

### 6. CLI — `cli/src/commands/{bot,connection,model}.ts`

| Command | Notes |
|---|---|
| `botholomew bot list` / `view <slug>` | |
| `botholomew bot create --name … [--description …] [--model …] [--access-read t1,t2] [--access-write …]` | |
| `botholomew bot edit <slug> [--name] [--slug] [--description] [--model] [--enabled] [--concurrency-cap n] [--monthly-budget usd]` | A slug change reports how many files moved |
| `botholomew bot delete <slug>` / `make-leader <slug>` / `validate <slug>` | |
| `botholomew bot prompt <slug> [--sample "text"]` | The prompt preview; prompts themselves are edited with `botholomew memory edit bots/<slug>/prompts/goals.md` |
| `botholomew connection list` / `probe <name>` / `delete <name>` | |
| `botholomew connection put --name … --kind … [--base-url …]` | Key from stdin or a hidden prompt, never an argument |
| `botholomew model list` / `options --connection <name>` | |
| `botholomew model create --name … --connection … --model … [--default] [--fast]` / `edit` / `delete` | |

### 7. User docs — `frontend/src/content/docs/{bots,connections-and-models}.md`

New pages, registered in `sections.ts`: bots (roles, descriptions as routing, access and the honesty note,
prompt files, layer order and why, rename behaviour) and connections and models (BYOK, kinds, probes, the
registry, precedence, fast fallback). Update `memory.md` (bot namespaces), `security.md` (encryption,
`connection:put` not over MCP), `cli.md`, `mcp.md`.

### 8. Tests — `backend/__tests__/…`

- `actions/bot.test.ts` — signup seeds the leader and three files authored by the user, in the project's
  transaction; a second leader is refused by the index; `make-leader` swaps and leaves exactly one; deleting
  or demoting the leader is refused; **a slug rename moves every live file with lineage, tombstones the old
  paths, and writes one audit row**; `validate` reports a short description, a dangling pin, a missing
  default model, and a broken prompt file in one response; `bot:list` is filtered by `canReadBot`; admins
  bypass access lists; the outsider gets 403.
- `actions/bot-namespace.test.ts` — a bot writer may write `bots/<slug>/prompts/*` and `notes/**`; a member
  without write is refused; a write under a slug with no bot is refused.
- `ops/bot-prompt.test.ts` — layer order; **two builds across a changed clock produce byte-identical stable
  text** (the v1 regression); a `beliefs.md` edit changes only text after the identity and project layers;
  contextual selection ignores stopwords and respects the cap; an invalid file fails naming its path; every
  layer reports its `versionId`.
- `actions/connection.test.ts` — the stored row holds ciphertext, not the key; the response and audit row
  carry only `lastFour`; the request log shows `[[secret]]`; a private `baseUrl` is refused outside
  development; `connection:put` is absent from a human client's MCP tool list; delete is refused while a
  model uses it.
- `actions/connection-probe.test.ts` — against a `Bun.serve` fake provider: `ok`, `unauthorized`, and a hang
  that hits the deadline; the probe changes no column; a 302 to another host is not followed; a key echoed in
  an error body is scrubbed.
- `ops/model-resolution.test.ts` — v1's cases: override > pin > default, `shadowed`, an unknown name listing
  the available ones, fast falling back to default, a helpful error with no default, and another project's
  model refused.
- `actions/model.test.ts` — one default and one fast per project; rename rewrites pins; delete refused while
  default, fast, or pinned.
- `cli/__tests__/{bot,connection}.test.ts` — slug rename output; the key is read from stdin and never
  appears in argv.
- `frontend/e2e/bots.spec.ts` — sign up, see Botholomew, edit `goals.md` from the Prompts tab, see it in
  history, create a worker, open its prompt preview.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, in the browser:

1. Sign up. `/bots` shows Botholomew, the leader, with the owl avatar. Its Prompts tab lists `identity.md`,
   `goals.md`, `beliefs.md`, each with one version authored by you.
2. Settings → Connections: add an Anthropic key, press Test, see `ok`. Settings → Models: add `default` and
   `fast` on that connection, picking ids from the suggestions.
3. Open Botholomew's prompt preview, type a sample message, and watch a `contextual` project prompt you
   created join below the breakpoint.
4. Create a worker "Researcher" with a one-word description; Validate reports the description.
5. Rename its slug to `research`; its files now live under `bots/research/` with history intact.
6. `botholomew bot list`, `botholomew model list`, `botholomew connection probe anthropic` match the UI.

Then the edge cases:

- A wrong key probes `unauthorized`, and nothing about the row changes.
- Deleting the connection while `default` uses it is refused, naming the model.
- `make-leader research`, then try to delete it: refused.
- A member outside a bot's `accessWrite` gets 403 editing it, and is refused writing its `goals.md` — but
  can still read the file, as the docs say.
- Drop `title:` from `identity.md` in the editor: phase 4's 406 names the field.

## Definition of done

- [ ] `bots` with the one-leader index, `concurrencyCap` and `monthlyBudgetUsd` declared for phase 6, and slug rules;
      `project_connections` (named) and `project_models` (default and fast indexes)
- [ ] `canReadBot` / `canWriteBot` ported; `bots/<slug>/**` writes gated by them; unknown slugs refused
- [ ] Leader seeded in the project transaction with owl persona files; `bots:ensure-leaders` backfills
- [ ] Slug rename moves the namespace with lineage in one transaction; leader swap; leader never deletable
- [ ] `buildPromptLayers` in volatility order with no per-request text above the breakpoint; contextual
      matching with stopwords and caps; version ids returned; `bot:prompt-preview`
- [ ] Connections encrypted, named, BYOK, SSRF-guarded, no redirects with keys; `connection:put` never MCP
- [ ] `ModelOps` resolution with v1's precedence, `shadowed`, fast fallback, and listing errors
- [ ] `bot:validate` reports every problem at once
- [ ] Bots pages, editor, prompt preview, Connections and Models settings
- [ ] `botholomew bot`, `connection`, `model`; user docs; all tests above, twice in a row

## Commands

```bash
botholomew bot list --json
botholomew bot create --name "Researcher" --description "Finds, reads, and summarizes sources for the team"
botholomew memory edit bots/researcher/prompts/goals.md -m "focus on primary sources"
botholomew bot prompt researcher --sample "summarize the Q3 pricing research"
printf %s "$ANTHROPIC_KEY" | botholomew connection put --name anthropic --kind anthropic
botholomew model create --name default --connection anthropic --model <provider-model-id> --default
psql botholomew -c "select slug, role, model_name, concurrency_cap from bots where project_id = 1;"
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
