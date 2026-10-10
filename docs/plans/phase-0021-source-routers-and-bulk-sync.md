# Phase 21 — Source routers and bulk sync

> **Goal:** An admin maps a URL pattern to a read tool on one of the project's MCP servers. With that mapping in
> place, anyone in the project can add a Google Doc, a private GitHub issue, or a Linear ticket by pasting its
> URL, refresh replays exactly that call, and a whole repository's issues or a team's tickets can be imported as
> one collection and optionally kept in sync — with every credential living only on the project's MCP servers.

> **Status: planned, not built.** Stage F — Memory, extended. Depends on
> [phase 10](./phase-0010-mcp-servers-and-approvals.md) (MCP servers, credentials, the backend MCP client, the
> approval gate), [phase 19](./phase-0019-url-ingest.md) (fetcher identity, fencing), and
> [phase 20](./phase-0020-upstream-refresh.md) (the refresh dispatch table and machine authorship).

[Phase 19](./phase-0019-url-ingest.md) reads the public web and nothing else, on purpose: it sends no credential.
But the documents teams most want their bots to know live behind sign-in. membot reaches them two ways, and 2.0
keeps neither as it is. Its built-in downloaders (`github`, `github-repo`, `linear`, `linear-team`) each carry
an API key in a config slice — a second credential store beside everything else. Its custom routers spawn a
shell command per URL, and the README's own Google Docs example is a router that shells out to
`mcpx exec GoogleDocs_GetDocumentAsDocmd`: the credential is already on an MCP server, and the shell is only
the way to reach it.

2.0 has no shell on the server and already holds encrypted, OAuth-capable MCP credentials per project
([phase 10](./phase-0010-mcp-servers-and-approvals.md)). So a router here is membot's custom router with the shell
replaced by one MCP tool call: a URL regex with named groups, a server, a tool, an arguments template, a mime,
and a post-processor. The four API-key downloaders become **presets** for routers over GitHub and Linear MCP
servers, and bulk import becomes a router whose tool *lists* items, each of which is then fetched by an ordinary
URL router.

## Scope

**In:** `memory_source_routers` (URL and enumerator kinds) and `memory_source_collections`; JSON argument
templates with `{group}` / `{url}` substitution in string leaves only; result extraction and the
`passthrough` / `html-to-markdown` / `docmd` / `json-to-markdown` post-processors; linear-time pattern matching;
dispatch order (scheme routers → URL routers → phase 19's public fetch); the `router` fetcher registered in phase
20's table, persisting router id and captured vars so refresh replays exactly; enumeration with pagination,
caps, and an unchanged probe; opt-in sync with a completeness rule and a mass-removal guard; the router's place
in phase 10's approval and allowlist model; router test with dry match and optional execution; presets; actions,
`memory_add` dispatch and `memory_sources`; Settings → Memory sources; `botholomew memory router …` and
`collection …`; user docs; tests against phase 10's fake MCP server.

**Out:** multi-call routers (an issue *and* its comments as two tool calls — choose a tool that returns both, or
compose in code mode, [phase 11](./phase-0011-code-mode.md)); per-asker credentials (unphased — routers use
the server's project-level credential); shell routers and shell post-processors, ever; Apple Notes and other
local-machine sources (the CLI uploads files instead); write-capable tools as routers.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| Custom routers | Named-group regex, `{var}` / `{url}` substitution, argv slots no value can escape, `mime_type`, `post_process`, `timeout_ms`, persisted `{ router, vars }` so a later pattern edit cannot re-route an old row | [src/ingest/sources/custom-command.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/custom-command.ts), README [Custom URL routers](https://github.com/evantahler/membot/blob/main/README.md#custom-url-routers) |
| Router validation | Name grammar, unique names, compilable patterns, every placeholder a real group | [src/config/router-validation.ts](https://github.com/evantahler/membot/blob/main/src/config/router-validation.ts) |
| Post-processors | `passthrough`, `docmd` (`normalizeDocmd`), `html-to-markdown`, `substituteVars` | [src/ingest/sources/post-processors.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/post-processors.ts) |
| Plugin contract | `enumerate`, `rehydrateEntry`, `probeUnchanged`, `sync`; scheme before URL before dynamic matching | [src/ingest/sources/types.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/types.ts), [src/ingest/sources/registry.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/registry.ts) |
| What the downloaders fetch | Issue and PR URLs, Linear issues and projects, their logical paths | [src/ingest/sources/github.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/github.ts), [src/ingest/sources/linear.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/linear.ts) |
| Bulk + sync | Paginated enumerate, `mtime` probe, selector-scoped sync that tombstones only its own rows | [src/ingest/sources/github-repo.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/github-repo.ts), [src/ingest/sources/linear-team.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/linear-team.ts) |
| v1's approval policy | Default-deny, allowlist patterns, `auto_allow_read_only` | [src/mcpx/client.ts](https://github.com/evantahler/botholomew/blob/v1/src/mcpx/client.ts), [docs/approvals.md](https://github.com/evantahler/botholomew/blob/v1/docs/approvals.md) |
| MCP servers, credentials, client, gate, bot allowlist | Everything a router calls through | [phase 10](./phase-0010-mcp-servers-and-approvals.md) (from `toolexec:backend/schema/sandbox_mcp_gateways.ts`, `toolexec:backend/schema/gateway_credentials.ts`) |
| Fetch identity, fencing, collisions | `sourceType` (phase 4 reserves `router`), `sourceUri`, `fetcherArgs`, `untrusted`, path ownership, URL ingest jobs | [phase 19](./phase-0019-url-ingest.md) |
| Refresh | `FETCHERS`, claims, `systemActor`, conflict and gone handling | [phase 20](./phase-0020-upstream-refresh.md) |

## What this must not weaken

1. **One credential home.** No router, preset, or collection stores a token; every call uses the server's
   `mcp_credentials`. A no-secrets test in the shape of `toolexec:backend/__tests__/actions/no-secrets.test.ts`
   covers every new table.
2. **No shell, and no template injection.** Captured values are substituted into string leaves of an already
   parsed JSON template, so a value can never become a key, a number, or a second argument.
3. **A bot never reaches a server it is not allowlisted on** — a router is not a side door around phase 10.
4. **Router tools only read.** A router is an unattended, pre-approved call; it must not be able to send, write,
   or delete.
5. **Sync only removes what it created, only after a complete enumeration, and never silently in bulk.**
   Ordinary refresh still never tombstones ([phase 20](./phase-0020-upstream-refresh.md)).
6. **Router output is untrusted** and fenced exactly like a fetched page.
7. **Deterministic replay**: refresh re-runs the same router with the persisted vars; no model picks a tool.

## Design

### A router is one tool call

| Field | Meaning |
|---|---|
| `kind` | `url` (one item) or `enumerator` (lists items) |
| `pattern` | Regex matched against the full URL, or against a scheme source such as `github-repo:owner/repo:issues` |
| `mcpServerId`, `tool` | One of the project's servers and one tool on it |
| `argsTemplate` | A JSON object; `{name}` / `{url}` inside string values are substituted after parsing |
| `extract` | `text` (concatenate text blocks), `resource` (first embedded resource and its mime), or `json` + a JSON Pointer into `structuredContent` |
| `mimeType`, `postProcess` | What the extracted bytes are, then `passthrough` \| `html-to-markdown` \| `docmd` \| `json-to-markdown` |
| `pathTemplate` | Optional, e.g. `github/{owner}/{repo}/issues/{number}.md` (membot's layout); default `remotes/<host>/<path>` |
| `priority`, `timeoutMs`, `maxBytes`, `enabled` | First match by priority wins; 60 s (membot's `timeout_ms`, within the server's own `timeoutMs`) and 25 MiB (phase 9's cap, inside phase 10's 32 MiB response abort) |

`json-to-markdown` is new: many MCP tools return structured JSON, which membot hands to a model to tidy when it
has a key. Here a deterministic renderer turns objects into headings and definition lists and long strings into
paragraphs. A router that would rather keep the JSON declares `application/json` with `passthrough`, and gets phase
9's fenced block or, where enabled, [phase 22](./phase-0022-llm-assisted-ingestion.md)'s model normalizer.

Patterns run on every add against a string a bot may have chosen, so a backtracking regex an admin wrote by
accident is a CPU denial of service. Patterns compile with an RE2 engine built to WASM — linear time, no native
addon — and validation refuses lookaround and backreferences with a hint. URLs over 2 KB are refused before
matching. Placeholders are checked against named groups at write time, as membot's `validateRouters` does, and
`pathTemplate` substitutions are run through phase 4's path validator (a captured `../` is refused).

### Dispatch and replay

Matching runs scheme enumerators first, then URL routers by `priority`, then [phase 19](./phase-0019-url-ingest.md)'s
public fetch as the catch-all — the inverse of membot, where built-ins beat custom routers, because here routers
are the specific path and the public fetch the generic one. `--router <name>` and `--fetcher url` override,
like membot's `--downloader`.

A router-fetched version stores `sourceType = 'router'`, the URL in `sourceUri`, and
`fetcherArgs = { routerId, routerName, vars, collectionId? }`, staged through the same ingest job as a
[phase 19](./phase-0019-url-ingest.md) fetch. Refresh looks the router up **by id**, not name
(membot's name lookup breaks on rename), substitutes the persisted vars into the router's *current* template, and
calls again — so fixing a router's arguments fixes every file it owns, while a pattern change never re-routes an
existing file. A deleted or disabled router fails refresh with a hint naming it; `memory-router:delete` refuses
while files reference it unless `force`, and says how many.

### Approval and the allowlist: the definition is the approval

[Phase 10](./phase-0010-mcp-servers-and-approvals.md)'s gate makes a person approve a bot's call before it runs.
Router calls do **not** go through it, and that is a decision, not an omission:

- Refresh and sync run unattended, at three in the morning, over hundreds of items. A per-call gate would turn
  "keep this doc current" into a queue of approvals nobody answers, and a 2 000-issue import into 2 000.
- The call is fully determined by an **admin-authored, audited** definition — server, tool, template, extraction —
  plus values captured by the admin's own regex. Creating or editing a router *is* the approval of that call
  shape, recorded in `audit_logs` like any other admin decision.
- The tool must be read-only: phase 10's indexed `mcp_tools.readOnly` (from `readOnlyHint`), or an admin's
  explicit `acknowledgeNotReadOnly` with a reason, which the audit row carries. Without one the router is refused.
  This is the same judgement phase 10's `autoAllowReadOnly` asks an admin to make about a server, made once per
  router instead.

What the definition does **not** grant is reach. A bot's `memory_add` through a router requires
`McpServerOps.canBotUse(server, bot)`, exactly as `mcp_exec` would, and a server that is disabled or has the tool
in `disabledTools` refuses every router on it. A person's add requires memory write, since people do not
hold server allowlists. The router form says plainly what this means: anyone in the project can read anything the
server's credential can read *through this pattern*. Unattended refresh runs as the system, replaying only calls
already made. For the same reason phase 10 keeps `mcp-server:create` off MCP, router mutations are **never** MCP
tools: a router widens who can read through a credential, and a model in someone's MCP client should not be able
to arrange that.

### Collections: enumerate, then fetch

An enumerator router's `listSpec` names the list tool's arguments, the JSON Pointer to the items array, each
item's URL and `updatedAt` pointers, and the cursor field for the next page. Adding `github-repo:acme/api:all`
creates a **collection** row and a parent ingest job; enumeration pages through the list tool up to
`collectionMaxItems` (5 000) and `collectionMaxPages` (100), and each item becomes a child job that goes through
ordinary URL dispatch — so the GitHub issue preset serves both a pasted URL and a 2 000-issue import, as membot's
`github-repo` reuses `github`'s fetch. When an item's `updatedAt` equals the file's stored `sourceLastModified`,
the child skips the fetch (membot's `probeUnchanged`). Children run at `collectionConcurrency` (2) per server so a
credential's rate limit is not spent in a burst. A collection can carry a [phase 20](./phase-0020-upstream-refresh.md)
cadence, which re-enumerates and fetches what is new or changed.

Bots may add single items through routers; creating a collection is a person's decision unless the project
setting `botsMayImportCollections` is on (off by default) — bulk volume, rate limits, and noise are cost a person
should choose.

### Sync is opt-in, complete, and guarded

`syncMode = 'tombstone'` on a collection makes each enumeration tombstone files that the collection created
(`fetcherArgs.collectionId`) and the source omits — `operation = 'delete'`, `systemActor = 'sync'`, and
a note such as `sync: issue #412 no longer listed by github-repo:acme/api:issues`. Three rules keep it from being
the worst button in the product:

1. **Only after a complete enumeration.** Any failed page, a timeout, or hitting `collectionMaxItems` makes the
   run *partial*, and a partial run tombstones nothing. An API hiccup that returns zero items would otherwise
   empty the collection.
2. **Only unedited files.** A file whose current version is not router-written (someone edited it) is reported,
   not removed.
3. **No silent mass removal.** If a run would tombstone more than `syncMaxRemovalFraction` (20%) of the
   collection, it tombstones nothing, notifies admins with the count, and waits for `collection sync --confirm`.

membot's caveat survives and is documented: an open-only selector treats closing an issue as removal; choose
`:all` to keep closed items. Tombstones are reversible through phase 4's undelete.

### Presets replace downloaders

A preset is a JSON row template — no code path — offered when the selected server's tool list contains the
expected tool. The initial set covers membot's sources: GitHub issue and PR (URL), GitHub repository
(enumerator), Linear issue and project (URL), Linear team (enumerator), and Google Docs (URL, `docmd`, the
README's own example). Tool names differ between servers, so a preset is chosen per server family and is fully
editable once created.

## Steps

### 1. Schema — `backend/schema/{memory_source_routers,memory_source_collections}.ts`

`memory_source_routers`: `projectId` (cascade), `name` (unique per project; membot's name grammar), `kind`,
`pattern`, `mcpServerId` (→ `mcp_servers`, `no action`: phase 10's `mcp-server:delete` is refused while routers
use the server, naming them, and a project cascade still removes both), `tool`, `argsTemplate jsonb`, `extract jsonb`,
`mimeType`, `postProcess`, `pathTemplate`, `listSpec jsonb` (enumerators only, Zod-typed), `priority`,
`timeoutMs`, `maxBytes`, `enabled`, `readOnlyAcknowledgement` (nullable text), `createdByUserId`, timestamps.
Index `(projectId, enabled, priority)`.

`memory_source_collections`: `projectId`, `routerId` (→ routers, `no action`), `source`, `vars jsonb`,
`pathPrefix`, `syncMode` (`none` \| `tombstone`), `lastEnumeratedAt`, `lastItemCount`, `lastStatus`
(`ok` \| `partial` \| `failed` \| `awaiting_confirmation`), `pendingRemovalCount`, `createdByUserId`, timestamps.
Unique `(projectId, source)`. Phase 20's `memory_refreshes` gains a nullable `collectionId`, with a check that
exactly one of `logicalPath` and `collectionId` is set, so a collection's cadence is claimed by phase 20's clock
with no second scheduler.

### 2. Ops — `backend/ops/MemorySourceOps.ts`

- `compileRouter(def)` — RE2 compile, placeholder and path-template checks; hinted refusals.
- `matchSource(projectId, input, { override })` → `{ router, vars } | { fetcher: 'url' } | null`.
- `renderArgs(template, vars, url)` — substitute in string leaves of the parsed object only.
- `callRouter(router, vars, url, { actor })` — `canBotUse` for bot actors, then phase 10's
  `McpClientOps.callTool` with the server's credential, `timeoutMs`, `maxBytes`; failures keep phase 10's
  `error_kind`s; extract, post-process, sha.
- `enumerate(collection)` → `{ items, complete }`; `syncCollection(collection, items, { confirm })`.
- `registerFetcher('router', …)` into phase 20's `FETCHERS`.

### 3. Actions — `backend/actions/memory-router/*.ts`, `backend/actions/memory-collection/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory-router:create` / `:edit` / `:delete` | `PUT` / `POST` / `DELETE /memory/router` | `AdminMiddleware()` | Yes | **Never** — widens credential reach |
| `memory-router:view` / `:list` | `GET /memory/router`, `GET /memory/routers` | `ProjectMemberMiddleware()` | — | Yes |
| `memory-router:test` | `POST /memory/router/test` | member for match; `AdminMiddleware()` when `exec` | No — writes nothing | Yes |
| `memory:sources` | `GET /memory/sources` | `ProjectMemberMiddleware()` | — | Yes |
| `memory-collection:create` / `:edit` / `:delete` | `PUT` / `POST` / `DELETE /memory/collection` | member + `canWritePath` (`edit` of `syncMode`: admin) | Yes | Yes |
| `memory-collection:list` / `:view` | `GET /memory/collections`, `GET /memory/collection` | `ProjectMemberMiddleware()` | — | Yes |
| `memory-collection:sync` | `POST /memory/collection/sync` | member + `canWritePath`; `confirm` needs admin | Yes | Yes |
| `memory-collection:enumerate` | — (task-only child, `default`) | — | No — the job rows are the record | No |

`memory-router:test` returns the matched router (or which fetcher would win instead), the captured vars, and the
rendered arguments; with `exec` it makes the call and returns mime, sha, size, the target path, and the first
4 KB of markdown — writing nothing. `memory:add` with `url` dispatches through `matchSource`.

### 4. Bot tools — `backend/bots/tools/memory/{add,sources}.ts`

`memory_add url` dispatches through routers transparently; refusals are `policy_error` with reason
`not_allowlisted` (naming the server and that an admin can allowlist this bot) or `collection_requires_person`.
Router output is fenced as `source="router:<name>"`. `memory_sources` lists routers,
collections, and the public fetcher with example inputs, as membot's `membot_sources` does; it has no honest bash
analogue, so no bash tag. Both `replay: safe`.

### 5. Frontend — `frontend/src/components/settings/sections/MemorySources.tsx`

Settings → **Memory sources**: routers (name, pattern, server · tool, files owned, last used, enabled), a create
and edit form with a preset picker filtered by each server's tools, the read-only status, and a live tester (URL
in, match and rendered arguments out, **Run** for admins). A Collections table shows source, items, last
enumeration, status, sync mode, and cadence, with **Sync now**, and a confirmation card for a held mass removal.

### 6. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory router add --name n --pattern re --server s --tool t --args json [--extract …] [--mime m] [--post-process p] [--path-template t] [--preset name]` | Admin |
| `botholomew memory router list` / `remove <name> [--force]` / `test <url> [--exec]` | |
| `botholomew memory sources` | Routers, collections, public fetch |
| `botholomew memory add "github-repo:acme/api:all" [--sync] [--refresh 24h]` | Creates a collection |
| `botholomew memory collection list` / `sync <id> [--confirm]` / `remove <id>` | |

### 7. User docs — `frontend/src/content/docs/memory-sources.md`

A new page (added to the docs sections list): what a router is, presets, the read-only and allowlist rules,
"anyone in the project can read what this credential can read through this pattern", collections, sync's three
rules, and the open-only selector caveat. `memory.md` links to it.

### 8. Tests

`backend/__tests__/actions/memory-router.test.ts` — against phase 10's fake MCP server:

- A placeholder with no named group, a lookahead, and a duplicate name are refused at create; an admin can
  create, a member cannot; every mutation is audited.
- A captured value containing `"`, `}`, and `{other}` lands as one literal string argument.
- A tool without `readOnlyHint` is refused unless acknowledged, and the acknowledgement is in the audit row.
- Dispatch order: a router beats the public fetch; `--fetcher url` overrides; scheme beats URL.
- A bot not allowlisted on the server is refused with `not_allowlisted`; a person with write succeeds; a disabled
  tool refuses every router on it; router mutations are not MCP tools.
- Refresh replays by router id after a rename, uses the edited template, and fails with a hint once deleted.
- `test` with `exec` writes no file and no version.

`backend/__tests__/actions/memory-collection.test.ts` — pagination to completion; the `updatedAt` probe skips
fetches; a failed page marks the run partial and tombstones nothing; a 50% removal is held and notified, then
applied with `--confirm`; an edited file is reported, not removed; tombstones carry `systemActor = 'sync'`;
`collectionMaxItems` truncation is partial; a bot cannot create a collection by default.

`backend/__tests__/actions/no-secrets.test.ts` (ported from ToolExec if no earlier phase has) gains both tables. `frontend/e2e/memory-sources.spec.ts` — create
from a preset, test a URL, add it, see the file. `cli/__tests__/memory.test.ts` covers `router` and `collection`.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

With a GitHub MCP server connected in Settings → MCP servers:

1. Settings → Memory sources → New router → preset **GitHub issue**. The tester shows `owner`, `repo`, `number`
   for a private issue URL and the rendered arguments; **Run** previews its markdown.
2. `botholomew memory add https://github.com/acme/api/issues/12 --wait` lands at `github/acme/api/issues/12.md`
   with a Source block naming the router.
3. Ask a bot that is *not* on the server's allowlist to add another issue URL: refused, naming the server.
4. `botholomew memory add "github-repo:acme/api:issues" --sync`, then close an issue upstream and
   `botholomew memory collection sync <id>`: that file is tombstoned with a sync note; undelete restores it.

Then the edge cases:

- Make the fake server fail page 3 of 5: the run is `partial` and nothing is tombstoned.
- Remove most issues upstream: the sync is held for confirmation and admins are notified.
- Delete the router while files use it: refused with a count; with `--force`, their refresh fails with a hint.

## Definition of done

- [ ] Router and collection tables; RE2 matching; JSON templates substituted in string leaves only
- [ ] Extraction and the four post-processors, including deterministic `json-to-markdown`
- [ ] Dispatch order with overrides; `sourceType = 'router'` replays by id with persisted vars
- [ ] Read-only enforcement, the bot allowlist honoured, router definitions audited as the approval
- [ ] Enumeration with pagination, caps, probe, and per-server concurrency; collections on phase 20's clock
- [ ] Sync: own files only, complete runs only, edited files spared, mass removal held for confirmation
- [ ] Presets for membot's GitHub, Linear, and Google Docs sources
- [ ] Actions, `memory_sources`, Settings → Memory sources, CLI, the new docs page, tests as listed

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
