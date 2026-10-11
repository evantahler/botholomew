# Botholomew 2.0 — Build Plans

Botholomew 2.0 is a **cloud service of always-on bot swarms**. Every project gets a team of bots — one
**leader** and any number of **workers** — that do work, watch work, and are always there when somebody
needs them. They hibernate when nobody is talking to them and wake when a person, another bot, a schedule, or
an event gives them something to do. They share the project's **memory**, its **MCP servers**, and its
**skills**, and each has its own **prompts, identity, and goals**. People reach them from the website, the
CLI (commands or an interactive TUI), Slack, and iMessage.

The product model is xAI's [Grok Bot](https://docs.x.ai/grok-bot/overview) — "a team of always-on AI
teammates" — rebuilt as a multi-tenant service on **[Keryx](https://keryxjs.com/)**, the framework in which
one Action class is simultaneously an HTTP endpoint, a WebSocket action, a CLI command, a background task,
and an OAuth-protected MCP tool.

> **Status: planned.** Nothing in 2.0 is built. The v1 local CLI/TUI agent (v0.27.3) occupies this repository
> and lives permanently on the [`v1` branch](https://github.com/evantahler/botholomew/tree/v1);
> [phase 1](./phase-0001-clean-slate-and-shell.md) removes it from this one. The v1 milestone docs sit beside
> these files (`milestone-*.md`, indexed by [`v1-milestones.md`](./v1-milestones.md)), and phase 1 removes them
> too.

## What we are building on

Three earlier projects, read closely, and two outside ideas:

| Source | What 2.0 takes from it |
|---|---|
| **ToolExec** (`arcadeai-labs/toolexec`, private) | The whole plumbing: Bun workspaces (`backend/`, `frontend/`, `cli/`), Keryx actions, users, projects as tenants, tag-based RBAC, invites, `AuditedAction`, MCP OAuth for human clients, WebSocket channels, notifications, encrypted connections, gateway OAuth, the product CLI, CI with one `complete` gate, the Render blueprint, and its planning discipline (this directory's format). Its settled-but-unbuilt Slack/iMessage design becomes [phase 16](./phase-0016-slack.md) and [phase 17](./phase-0017-imessage.md). |
| **Botholomew v1** ([`v1` branch](https://github.com/evantahler/botholomew/tree/v1)) | The agent's soul and its lessons: the owl persona; prompts with `loading` / `agent-modification` frontmatter; skills with `$ARGUMENTS`; task DAGs; MCP meta-tools (search → info → exec); the approval gate; the named model registry; `backend/llm/` boundary rules; tools named after bash; and sandboxed TypeScript (`membot_run`) as code mode. |
| **[membot](https://github.com/evantahler/membot)** | The knowledge model: logical paths, append-only versions, markdown surrogates for every format, local embeddings, hybrid BM25 + semantic search, refreshable sources — ported onto Postgres + pgvector as **project memory**. |
| **[pi-durable](https://earendil.com/posts/pi-durable/)** | Durable agent mechanics: commit intent → perform effect → commit outcome; per-tool replay safety; exactly-once `requestId`s; follow-up vs steer inboxes; background compaction; system entries recorded where they took effect. |
| **[Grok Bot](https://docs.x.ai/grok-bot/overview)** | The product shape: bots with names and jobs; each thread its own conversation; one owner per thread; async bot-to-bot messages that wake the receiver; human messages first; recurring work with auto-pause; the failure modes of unrestricted swarms. |

## The data model

```
Organization                      thin grouping: members, projects, billing (unphased)
└── Project                       the tenant and the privacy boundary
    ├── Members                   users × tags (reserved `admin`); per-bot read/write tag lists
    ├── Bots
    │   ├── Leader bot            exactly one; default owner of new threads; monitors the workers
    │   └── Worker bots 1…N
    │       each: identity (row) · prompts, identity.md, goals.md, beliefs.md (files in memory)
    │             model · access tags · budgets · status (hibernating | working | waiting | paused | errored)
    ├── Threads                   what people see: messages from people and bots
    │   └── Conversations         what a bot sees: one LLM context per bot × thread
    ├── Tasks                     delegated work: a DAG of bot tasks with outputs, owned by a bot
    ├── Schedules                 v1's recurring work: natural-language cadence → tasks for a bot
    ├── Shared memory             versioned filesystem + hybrid search (skills/ and prompts/ live here too)
    ├── Shared MCP servers        remote MCP servers + encrypted credentials + per-server bot allowlist
    ├── Shared skills             skills/<name>.md in memory; slash commands for people, loadable by bots
    └── Connections & models      BYOK model providers + a named model registry
```

## Decisions already made

| Topic | Decision |
|---|---|
| Repository | Rewrite this repo. v1 is preserved on the `v1` branch. [Phase 1](./phase-0001-clean-slate-and-shell.md) is a clean break: the tree is emptied (no `install.sh`, no VitePress site, no v1 workflows) and ToolExec's shell is copied in. |
| Organizations | A **thin grouping** above projects. No permission is evaluated at the organization level; every check is a project check ([phase 3](./phase-0003-organizations.md)). |
| Privacy boundary | **The project is the boundary.** There are no private threads. Anything said to a bot may surface to anyone who can read that bot — the same honesty Grok Bot's docs apply ("do not use separate Bots as a security boundary"). |
| Model keys | **BYOK only.** Model calls use the project's own encrypted provider connection; the platform holds no model key. |
| Embeddings | A **local WASM model in the worker** (membot's `bge-small-en-v1.5`, 384-d) — no key, no platform API spend. |
| Memory | A **Postgres + pgvector port** of membot's model, scoped per project. |
| Prompts & skills | **Files in project memory** at reserved paths with strict frontmatter, so they inherit versioning, diff, restore, search, editing, the UI, and the CLI. |
| Agent execution | **No sandbox VMs.** The bot loop runs in the Keryx worker; code mode is QuickJS-in-WASM with host functions only. ToolExec's model and gateway proxies are unnecessary because no guest code ever holds a credential. |

## Core architecture

The details, arguments, and tests live in [phase 6](./phase-0006-durable-bot-loop.md); this is the summary every
other phase builds on.

### Two processes, one image

The API process serves HTTP, WebSockets, and `/mcp`; the worker process runs Keryx tasks and owns
migrations — ToolExec's topology unchanged ([phase 2](./phase-0002-deployment.md)). Postgres holds every fact;
Redis holds sessions, the Resque queues, PubSub, and MCP sessions, and is never the only copy of anything.

### A conversation is leased; a bot is capped

A **conversation** is one bot in one thread: the unit of LLM context and of the lease (`leaseOwner`,
`leaseEpoch`, `leaseExpiresAt`). Each bot has a concurrency cap on leased conversations with one slot
reserved for human-initiated work, so a slow tool call in one thread never blocks a person in another.
`bots.status` is derived from the bot's conversations. The project's `concurrencyLimit` is checked when a
lease is acquired, on every path.

### A tick is a small state machine

```
bot:tick {conversationId}                                     queue: bots, explicit timeout
  1 acquire lease, bump leaseEpoch ─── every later write fenced: WHERE leaseEpoch = $mine
  2 re-authorize from Postgres     ─── task connections carry no session
  3 run approved/pending tool calls first (no model call needed)
  4 hydrate from latest compaction/reset entry → model step(s)
       several steps per tick while nothing outranks this conversation (≈4 min / N steps cap)
       lease TTL 60–90 s, renewed every ~15 s while streaming; failed renewal aborts the call
  5 release:  UPDATE … SET lease = NULL, wakeRequested = false RETURNING wakeRequested
              → re-enqueue if a message arrived mid-tick; otherwise hibernate the conversation
```

### Commit intent, perform the effect, commit the outcome

Every model call is a `model_steps` row committed **before** the request. Every tool call is a `tool_calls`
row: `pending → (awaiting_approval → approved | denied) → started → succeeded | failed | interrupted |
unknown`. Tools declare `replay: safe | unsafe`; an unsafe call found `started` after a crash becomes an
"outcome unknown — verify before retrying" result, never a blind re-run. Two crashes on one step mark the
conversation `errored` and notify a person, so a poison message cannot loop and spend forever. Every inbound
message carries a `requestId`, unique per project, so retries are exactly-once.

### The row is the delivery; the queue is an accelerant

An inbox insert enqueues `bot:tick` in `afterCommit`. A `bots:dispatch` clock (30 s) claims leases for
conversations with pending inbox rows or a due `wakeAt` under a per-project advisory lock with `FOR UPDATE
SKIP LOCKED`, and `bots:reap` expires dead leases. This is forced by Keryx itself: one-off `enqueue` jobs get
no lock, dedupe, or retry, and a crashed job is never retried — so durability comes from Postgres plus a
reconciler, never from the queue. Priority is human > bot > event/schedule, with aging, and a turn's
continuation inherits the priority of the message that started it.

### Humans see threads; bots see conversations

`threads` (owner bot, parent thread, kind `chat | dm | delegation | slack | imessage`) and `thread_messages`
are what people read. `conversations`, `conversation_inbox` (`follow_up | steer`), `conversation_entries`
(`user | assistant | tool_result | system | compaction | reset | event`, as AI SDK `ModelMessage` parts with
provenance), `model_steps`, `tool_calls`, and `usage_events` are what a bot runs on. **One output channel:**
only the text of a turn's final, tool-free step is posted to the thread; an empty final text is silence;
`send_message` reaches any other thread or bot.

### Guards from day one

A step cap per turn; repeated identical tool-call detection; `hopCount` and chain limits on bot-originated
messages with no human input; a per-project bot-message rate; per-bot and per-project budgets checked
against `usage_events`; and **provenance fencing** — MCP output, fetched pages, other people's Slack text,
and bot-to-bot text are wrapped as data, never as instructions.

### Notify after commit

Content-free WebSocket frames (`project:<id>:thread:<id>`, `…:bot:<id>`, `…:memory`, `…:notifications`)
tell clients what to re-read; token deltas travel on a separate, read-authorized `…:thread:<id>:stream`
channel. Slack and iMessage replies go through an `outbox` table; approvals and failures through
`notifications`.

### One definition, many surfaces

Human operations are Keryx actions — HTTP, WebSocket, the ops CLI, and MCP tools for human OAuth clients
(so Claude Desktop can message your bots and read project memory) — and the product CLI wraps the same HTTP
surface. Bot tools are in-process `ToolDefinition`s over the same `ops/` functions, described with
`[[ bash equivalent command: … ]]` tags and answering with structured, hinted errors. The system prompt's
tool list is generated from the registry, so it cannot drift from the code.

### Authorization and audit

Membership grants read on a project; the reserved `admin` tag grants administration; each bot carries
`accessRead` / `accessWrite` tag lists (write = message it, edit it, answer its approvals); each MCP server
carries an allowlist of the bots that may use it. Every human message is attributed to a person.
`audit_logs` records human decisions and, through `actorBotId` / `onBehalfOfUserId`, the changes bots make
(creating workers, editing prompts and skills).

## Project memory

Project memory is the project's filesystem: a versioned, searchable store addressed by `logical_path`,
replacing both v1's on-disk project and membot. [Phase 4](./phase-0004-project-memory-core.md) builds the
versioned filesystem (and carries the full membot feature map — what is brought, adapted, and dropped);
[phase 9](./phase-0009-memory-search-and-ingestion.md) adds local embeddings, hybrid search, uploads, and the
deterministic converters. Everything else membot does has its own phase in Stage F: adding from a
URL ([19](./phase-0019-url-ingest.md)), refreshing upstream content ([20](./phase-0020-upstream-refresh.md)),
MCP-backed source routers and bulk sync ([21](./phase-0021-source-routers-and-bulk-sync.md)), LLM-assisted
ingestion ([22](./phase-0022-llm-assisted-ingestion.md)), and keeping original bytes
([23](./phase-0023-original-bytes-and-blob-policy.md)).

```
skills/<name>.md                 shared skills        frontmatter: name, description, arguments
prompts/<name>.md                project-wide prompts, loaded by every bot
bots/<slug>/prompts/<name>.md    a bot's prompts      frontmatter: title, loading, agent-modification
                                 (seeded: identity.md, goals.md, beliefs.md)
bots/<slug>/notes/…              the bot's working notes
scratch/conversations/<id>/…     large tool results, swept by retention
everything else                  shared knowledge: uploads, notes, remotes/<host>/…
```

Writes to reserved paths are validated against strict frontmatter schemas; a bot edits its own prompts only
where `agent-modification: true` and may never flip that flag; prompt versions seen by the model are
recorded in the transcript. People manage memory through a browser/editor with history, diff, and restore in
the web app, and through `botholomew memory …` (including `pull` / `push` to edit in a local editor). Bots
use `memory_*` tools and, from [phase 11](./phase-0011-code-mode.md), `memory.*` inside code mode.

## Settled stack

| Layer | Choice |
|---|---|
| Runtime / language | Bun + TypeScript (strict). `bun` / `bunx` only |
| Framework | Keryx `^0.48` |
| Database | Postgres 18 + **pgvector**, Drizzle ORM, `drizzle-kit` migrations owned by the worker |
| Cache / queue | Redis — sessions, rate limits, `node-resque` tasks, PubSub, MCP session registry |
| LLM | Vercel AI SDK behind `backend/llm/` (ported from v1); Anthropic, OpenAI, OpenAI-compatible; BYOK |
| Embeddings | `bge-small-en-v1.5` (384-d) via transformers + onnxruntime-web WASM, in the worker |
| Code mode | Vercel's [Run SDK](https://vercel.com/blog/introducing-run) (npm `run`; QuickJS via quickjs-wasi) with curated host functions |
| MCP client | `@modelcontextprotocol/sdk`, remote (HTTP / SSE) servers only |
| Frontend | Vite + React 19 + React Router 7 + Tailwind + SCSS, types imported from the backend (no codegen) |
| CLI / TUI | Commander HTTP client; Ink 7 + React 19 for `botholomew chat` |
| Validation / lint | Zod v4; Biome; `bun run lint` = `tsc` + `biome check` |
| Deploy | Render blueprint: api, worker, frontend, Redis, Postgres — staging first |

## Non-negotiable rules

These carry over from ToolExec and v1. The repository's [`AGENTS.md`](../../AGENTS.md) — the single instruction file
for agents and people; `CLAUDE.md` is only a symlink to it — states them in full; in short:

1. **Tests required** — a real booted server over HTTP against an isolated test database; no mocks (a fake
   model server, fake MCP server, and deterministic fake embedder stand in for third parties).
2. **JSDoc everywhere.**
3. **Every CRUD set includes a paginated `list`** (`paginationInputs` / `paginate`).
4. **Keryx bugs go upstream** with a minimal repro rather than being worked around.
5. **Every data-changing human action is audited** through `AuditedAction`; the unaudited machine writers
   are a closed, argued list.
6. **Human MCP ≈ HTTP; never-MCP is a closed list** — login/signup, machine ingress (`webhook:*`), clocks,
   and anything that arms an unattended trigger.
7. **Never name a plan phase outside `docs/plans/`.**
8. **Docs and comments speak in the present tense** — they say what is, not what is to come or what came
   before; a test enforces the mechanical slice.
9. **User-facing docs ship with the feature**, in the same commit.
10. **The product CLI tracks the HTTP surface** — every phase ships its CLI commands.
11. **Bot tools are named and described like bash** (`[[ bash equivalent command: … ]]`) and answer with
    structured, hinted errors (Patterns for Agentic Tools).
12. **LLM access goes through `backend/llm/`**, and models are resolved at boundaries
    (`--model` > pin > default).
13. **The plans are kept current, and only half of each one is** — see below.

## Roadmap

| Phase | Title | Deliverable |
|---|---|---|
| **Stage A — Platform** | | |
| [1](./phase-0001-clean-slate-and-shell.md) | Clean slate and shell | v1 removed; ToolExec's plumbing copied and renamed; green CI; `AGENTS.md` made true |
| [2](./phase-0002-deployment.md) | Deployment | Render staging: api, worker, frontend, Redis, Postgres + pgvector; botholomew.com points at the app |
| [3](./phase-0003-organizations.md) | Organizations | Thin orgs above projects; signup creates a personal org and project; org switcher |
| **Stage B — One bot that thinks** | | |
| [4](./phase-0004-project-memory-core.md) | Project memory core | The versioned filesystem, reserved-path validation, keyword search, memory UI and CLI |
| [5](./phase-0005-bots.md) | Bots | Bot rows, prompts as memory files, BYOK connections, the named model registry, the seeded leader |
| [6](./phase-0006-durable-bot-loop.md) | The durable bot loop | Conversations, leases, the tick state machine, the effect sandwich, guards, `backend/llm/` |
| [7](./phase-0007-threads-and-web-chat.md) | Threads and web chat | Owner routing and mentions, live channels, notifications, the chat UI |
| [8](./phase-0008-context-management.md) | Context management | Background compaction, resets, large results in memory, thread search, cache discipline |
| **Stage C — Shared capabilities** | | |
| [9](./phase-0009-memory-search-and-ingestion.md) | Memory search and ingestion | Local embeddings, hybrid search, deterministic converters, uploads |
| [10](./phase-0010-mcp-servers-and-approvals.md) | MCP servers and approvals | Shared MCP servers with gateway OAuth, meta-tools, the approval gate, MCP-backed memory sources |
| [11](./phase-0011-code-mode.md) | Code mode | `run_code`: QuickJS in WASM over `memory.*` and `mcp.*`, encrypted continuations |
| [12](./phase-0012-skills.md) | Skills | Slash commands for people, `skill_read` for bots, the skills editor |
| **Stage D — Swarms** | | |
| [13](./phase-0013-leader-and-workers.md) | Leader and workers | Delegation, task DAGs, reporting back, the workforce check, swarm guards |
| [14](./phase-0014-schedules-and-wakeups.md) | Schedules and wakeups | v1's schedules (natural-language recurring work that spawns tasks), compiled once to cron; auto-pause; durable reminders; per-bot webhook triggers |
| **Stage E — Everywhere** | | |
| [15](./phase-0015-tui-and-cli-publishing.md) | TUI and CLI publishing | `botholomew chat` (Ink), npm `botholomew@2.x`, compiled binaries |
| [16](./phase-0016-slack.md) | Slack | Per-project Slack app, linked identities, threads as conversations, outbox, approval cards |
| [17](./phase-0017-imessage.md) | iMessage | Linq lines, reach and opt-out, reply threading |
| [18](./phase-0018-operations.md) | Operations | Retention, deletion semantics, key rotation, usage dashboards, behaviour evals |
| **Stage F — Memory, extended** | | |
| [19](./phase-0019-url-ingest.md) | URL ingest | "Add from URL": SSRF-guarded fetch, HTML → markdown, `remotes/<host>/…` paths |
| [20](./phase-0020-upstream-refresh.md) | Upstream refresh | Per-file refresh cadence and a refresh clock; a new version only when the source changed |
| [21](./phase-0021-source-routers-and-bulk-sync.md) | Source routers and bulk sync | MCP-backed routers replacing membot's GitHub/Linear downloaders and shell routers; bulk import and sync |
| [22](./phase-0022-llm-assisted-ingestion.md) | LLM-assisted ingestion | Image captions, LLM conversion fallback, LLM-written descriptions — on the project's own model |
| [23](./phase-0023-original-bytes-and-blob-policy.md) | Original bytes and blob policy | Keeping uploaded originals, download and re-convert, the size/mime policy |

Each phase ends in a reviewable, deployable state. The core of [phase 16](./phase-0016-slack.md) — linked
identities, threads as conversations, the outbox — depends only on phases 1–8 and may move up if Slack is
wanted sooner; its approval cards and slash commands wait for phases 10 and 12.

**Unphased:** organization billing; per-asker MCP authorization (Arcade user ids, "act as the
asker"); an auto-review model for approvals; project dump/apply; MCP Apps; bot templates; cross-encoder
reranking; private threads with audience-scoped memory.

## How these documents are maintained

Each phase doc is `phase-NNNN-<kebab-title>.md`: four digits so the files list in order, and a title so a search
for "slack" or "refresh" finds the file without opening this index. Each follows ToolExec's phase-doc format exactly: the **Goal** and **Status**; the
framing; **Scope** (in and out); **What already exists**; **What this must not weaken**; **Design**; numbered
**Steps** in the form `` ### N. Title — `path` `` (schema, config, ops, actions, clocks, bot tools, frontend, CLI,
user docs, tests); **Verification**, which always opens with the same command block —

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

— followed by a manual end-to-end script and its edge cases; a **Definition of done** checklist; optional
**Commands**; and **Learnings from the build**.

ToolExec's rule applies here unchanged: **a plan section is never updated** — it is the only record of the
intent, and the gap between it and the code is information — while **the learnings section is always
updated**, because it claims to describe the system as it stands. When a change invalidates a section's
premise, add a note and a translation table at its top rather than rewriting it in place.

**Both halves are written in the present tense.** A plan section states the design as though it stands ("the
tick acquires the lease"); a learnings section states what holds in the shipped system and why ("the fence
holds because…"), not the story of finding it. Neither narrates what is to come or what came before; history
lives in git, intent lives here. Every doc keeps its `## Learnings from the build` heading, and phase 1's
`links.test.ts` and `tense.test.ts` enforce the heading, every relative link in `docs/`, and the tense
denylist.

## References

| Reference | Where |
|---|---|
| Keryx | <https://keryxjs.com/> · source <https://github.com/actionhero/keryx> |
| ToolExec | `arcadeai-labs/toolexec` (private) — `AGENTS.md`, `docs/plans/README.md`, `docs/ARCHITECTURE.md`, and phase docs 04, 05, 12, 13, 17, 18, 19, 20, 21, 31, 32 |
| Botholomew v1 | <https://github.com/evantahler/botholomew/tree/v1> — `docs/architecture.md`, `docs/field-notes.md`, `src/worker/`, `src/llm/`, `src/tools/`, `src/skills/` |
| membot | <https://github.com/evantahler/membot> — `docs/plan.md`, `src/operations/`, `src/ingest/`, `src/search/` |
| pi-durable | <https://earendil.com/posts/pi-durable/> · <https://github.com/earendil-works/pi> (`packages/durable`) |
| Grok Bot | <https://docs.x.ai/grok-bot/overview> · <https://x.ai/news/introducing-grok-bot> |
| Patterns for Agentic Tools | <https://arcade.dev/patterns/llm.txt> |
