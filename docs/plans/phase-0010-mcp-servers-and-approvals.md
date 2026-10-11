# Phase 10 — Shared MCP servers and approvals

> **Goal:** A project admin connects a remote MCP server once — URL, OAuth or API key, and the bots allowed to
> use it — and those bots can find, inspect, and call its tools. Any call no rule allows stops and waits for a
> person with write access to the bot, who sees the exact call, approves or denies it from the inbox, the thread,
> or the CLI, and the call that runs is the one they saw.

> **Status: planned, not built.** Stage C — Shared capabilities. Depends on [phase 5](./phase-0005-bots.md)
> (bots, `CryptoOps`, `canWriteBot`), [phase 6](./phase-0006-durable-bot-loop.md) (`tool_calls`, the tick),
> [phase 7](./phase-0007-threads-and-web-chat.md) (notifications, live channels, the chat transcript),
> [phase 8](./phase-0008-context-management.md) (large-result offload), and
> [phase 9](./phase-0009-memory-search-and-ingestion.md) (the local embedder).

MCP is how a bot does anything outside Botholomew: read a GitHub issue, post to Linear, send an email. In v1 that
is mcpx — a per-user `servers.json`, stdio and HTTP servers, credentials in a local `auth.json`, and an approval
gate that works, but only by parking the whole task and re-running it from the top. A cloud service of always-on
bots changes three things at once: servers are shared by a team rather than owned by a laptop, credentials must
live where no bot or guest program can read them, and a decision made in a browser hours later has to resume
exactly the call that was paused.

ToolExec already solves the first two for its sandboxes: gateways with credentials bound by foreign key, the full
MCP OAuth client, a refresh clock, an SSRF guard, and a probe that tells an admin what a URL actually is the
moment they type it. This phase ports that machinery and drops the half that exists only because guest code
runs in a VM — there is no proxy, because the MCP client runs in the worker and no bot ever holds a token.
[Code mode](./phase-0011-code-mode.md) reuses everything here unchanged: the client, the policy, and the approval
record.

The approval half is v1's policy with v1's two worst failures fixed: approval re-runs the whole task, repeating
every ungated side effect before the pause, and decisions are matched to calls by a hash of byte-identical
arguments, so a re-run that phrases a call differently prompts again. Here an approval references a recorded
`tool_calls` row; approving it runs that row's arguments and nothing else, and the model is not asked to
regenerate anything.

## Scope

**In:** `mcp_servers` (remote `http` / `sse` only) with a per-server bot allowlist, disabled-tool patterns, and a
read-only trust flag; `mcp_credentials` (`oauth` / `api_key` / `none`) ported from `gateway_credentials`;
`oauth_client_registrations`, `OAuthClientOps`, the three-hop OAuth flow, and the refresh clock, all ported;
`NetworkGuardOps` on every outbound request; a probe action; a pooled backend MCP client on
`@modelcontextprotocol/sdk` with timeouts, session recovery, and `structuredContent` preserved; a per-project
tool index with keyword and semantic search; the bot tools `mcp_search`, `mcp_list_tools`, `mcp_info`,
`mcp_exec`; structural error classification; per-call replay classification from annotations; the approval
policy (project and per-bot rules, v1 pattern syntax, opt-in read-only auto-allow); the `approvals` table, parking,
allow once / always allow / deny, expiry, and approver notifications; MCP elicitation (URL and form) and OAuth
re-authorization routed to people as approvals; provenance fencing of everything a server says; the Settings
section, the approvals inbox, inline approval cards, the CLI, and user docs.

**Out:** stdio servers, ever (see [Design](#remote-only)). Per-asker MCP authorization — a credential per person,
"act as the asker" — is unphased. An auto-review model for approvals is unphased.
Argument-level rules ("allow `send_email` only to our domain") are outside this phase; rules here match server and tool
names. MCP-backed memory source routers, which replace membot's GitHub/Linear downloaders and shell routers, are
[phase 21](./phase-0021-source-routers-and-bulk-sync.md) — they reuse this phase's client, credentials, and SSRF
guard, and add nothing to it. Calling tools from code mode is [phase 11](./phase-0011-code-mode.md). Slack approval
cards are [phase 16](./phase-0016-slack.md); iMessage approvals [phase 17](./phase-0017-imessage.md). Exposing a
project's MCP servers to human OAuth clients as a passthrough gateway is not planned: bots are the only callers.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| `sandbox_mcp_gateways` and the gateway registry | The server row's shape — `name`, `url`, `transport` (`http` \| `sse`), non-credential `headers` — and a transport registry keyed by name | `toolexec:backend/schema/sandbox_mcp_gateways.ts`, `toolexec:backend/agents/gateways/{index,http,sse}.ts` |
| `gateway_credentials` and `GatewayCredentialOps` | A credential bound to its server by foreign key, never named; encrypted access and refresh tokens; `resource` and `tokenEndpoint` stored at grant time; `refreshFailedAt`; refresh under a row lock with rotation written in the same transaction | `toolexec:backend/schema/gateway_credentials.ts`, `toolexec:backend/ops/GatewayCredentialOps.ts` |
| `OAuthClientOps` and `oauth_client_registrations` | The MCP authorization client: RFC 9728 → 8414 → 7591 → PKCE with RFC 8707 `resource` on both requests; registrations reused per `(project, issuer)`; `selectScopes`; parked flows with peek-before-collect | `toolexec:backend/ops/OAuthClientOps.ts`, `toolexec:backend/schema/oauth_client_registrations.ts` |
| Gateway OAuth actions | The start → authorization server → unauthenticated `GET` return terminus → same-origin `POST` callback three-hop, with no `next` parameter | `toolexec:backend/actions/gateway/gateway-oauth-{start,callback,return}.ts`, `toolexec:frontend/src/pages/GatewayOAuthReturnPage.tsx` |
| `connections:refresh` → `connection:refresh-credential` | A refresh clock that fans out one child job per due credential, so one slow authorization server cannot stall the tick | `toolexec:backend/actions/connection/{connections-refresh,connection-refresh-credential}.ts` |
| `NetworkGuardOps` | `assertPublicUrl`: resolve, refuse if any address is private, loopback, link-local, reserved, or a cloud metadata service; fail closed; off outside production | `toolexec:backend/ops/NetworkGuardOps.ts` |
| `McpProbeOps` and `sandbox-gateway:probe` | ToolExec's first MCP client: never throws, never writes, classifies `auth_required` / `unreachable`, reports (never applies) transport fallback, bounds every request, reports `connectedAs` from unverified JWT claims | `toolexec:backend/ops/McpProbeOps.ts`, `toolexec:backend/actions/sandbox-gateway/sandbox-gateway-probe.ts`, `toolexec:frontend/src/components/settings/ProbeReport.tsx` |
| Human help | A request a person answers later: status lifecycle, an expiry clock, recipients by tag that never route around access, an inbox page | `toolexec:backend/ops/HelpOps.ts`, `toolexec:backend/actions/help/*.ts`, `toolexec:frontend/src/pages/HelpInboxPage.tsx` |
| `SchemaForm` | A JSON Schema rendered as a form — what a form elicitation asks for | `toolexec:frontend/src/components/SchemaForm.tsx` |
| v1 MCP meta-tools | Search → info → exec discipline, refusal of built-in names routed through `mcp_exec`, PATs envelopes | [src/tools/mcp/](https://github.com/evantahler/botholomew/blob/v1/src/tools/mcp/dispatch.ts) ([search](https://github.com/evantahler/botholomew/blob/v1/src/tools/mcp/search.ts), [info](https://github.com/evantahler/botholomew/blob/v1/src/tools/mcp/info.ts), [list-tools](https://github.com/evantahler/botholomew/blob/v1/src/tools/mcp/list-tools.ts), [exec](https://github.com/evantahler/botholomew/blob/v1/src/tools/mcp/exec.ts)) |
| v1 approval policy | `buildApprovalPolicy` (default deny, allowlist, opt-in `auto_allow_read_only`) and `matchesAllowlist` (exact, `*` wildcards, bare tool token, `/regex/flags`) — ported verbatim | [src/mcpx/client.ts](https://github.com/evantahler/botholomew/blob/v1/src/mcpx/client.ts) |
| v1 approval records | What to keep (a pending/approved/denied record a human decides) and what to remove (`callKey` matching, `decideAndRequeue` re-running the task) | [src/approvals/store.ts](https://github.com/evantahler/botholomew/blob/v1/src/approvals/store.ts), [src/approvals/decide.ts](https://github.com/evantahler/botholomew/blob/v1/src/approvals/decide.ts), [src/worker/approval.ts](https://github.com/evantahler/botholomew/blob/v1/src/worker/approval.ts) |
| The durable tick | `tool_calls` with `awaiting_approval → approved \| denied`, tick step 3 ("run approved calls first, no model call"), per-call `replay`, the `bots:dispatch` reconciler | [phase 6](./phase-0006-durable-bot-loop.md) |
| Notifications and channels | The `notifications` table, dispatch, bell, and content-free frames | [phase 7](./phase-0007-threads-and-web-chat.md) |

What does not exist anywhere: an MCP client that runs **calls** (ToolExec's only client probes; its sandboxes
call servers through a proxy), a tool index, an approval bound to a recorded call, and any handling of
elicitation — v1's mcpx client drops `elicitation/create` and URL-elicitation errors on the floor.

## What this must not weaken

1. **No credential leaves the worker's MCP client.** Not to a bot, a tool result, code mode, a log line, an audit
   row, a frame, or an API response; serializers carry status, mode, scopes, expiry, and `lastFour` only.
2. **Write on a bot never grants a credential.** A bot reaches a server only if the server's allowlist names it,
   and only admins edit that allowlist.
3. **Default deny.** A call no rule allows waits for a person. No failure — a policy that cannot be evaluated, a
   stale index, a server that omits annotations — becomes an allow.
4. **The person decides the exact call.** The arguments a person approved are the arguments sent, byte for byte.
   Nothing regenerates them, and nothing else re-runs because of the decision.
5. **Postgres first, then the network.** A call is a `tool_calls` row before any request; an approval is a row
   before any notification; a decision commits before the call it releases runs.
6. **Every human decision is audited**, whatever surface carried it — approve, deny, always-allow rules, server
   and allowlist edits, credential puts and OAuth completions.
7. **A URL somebody typed is fetched only through `assertPublicUrl`**, on every request: discovery hops, token
   endpoints, and endpoints a transport was redirected to.
8. **What a server says is data.** Results, tool descriptions, server instructions, and elicitation messages are
   fenced with provenance and never reach a system prompt as instructions.
9. **No process is spawned for a project.** No stdio server, no shell, no subprocess.

## Design

### Servers are the project's; bots opt in by allowlist

An MCP server is a project resource configured by an admin, not a bot setting. ToolExec hangs gateways off agents
because each agent gets its own sandbox config; here one server with one credential is shared, and the question is
which bots may use it. The answer is `mcp_server_bots` (or `allBots: true`, an explicit checkbox that also covers
future bots), edited by admins only. That is the rule the master plan states — write on one bot must not grant
every credential — and it is why allowlist edits are not a bot-write privilege: whoever could add a bot to a
server's list could hand themselves the server's credential by messaging that bot. A new server allows no bots
until an admin picks.

Admins may also disable tools on a server with the same pattern syntax as rules (`disabledTools`); a disabled tool
is not indexed, listed, searched, or callable. That is the deny side of the policy, kept at the server where the
credential's blast radius is decided.

### Remote only

`transport` is `http` (streamable HTTP) or `sse` (legacy). There is no stdio: a stdio server is a process the
worker spawns with the worker's environment, filesystem, and network, which in a multi-tenant service is arbitrary
code execution with every other project's credentials one `env` away. Projects that need a local tool run it
behind an HTTP MCP endpoint of their own (or a gateway such as Arcade) and point Botholomew at its URL.

### Credentials and OAuth, ported

`mcp_credentials` is `gateway_credentials` with `projectId` added and `gatewayId` renamed `mcpServerId`, plus
`apiKeyHeader` / `apiKeyScheme` (default `Authorization` / `Bearer`) because some servers want `X-API-Key`. The
OAuth flow is ToolExec's, unchanged in every load-bearing detail: discovery through RFC 9728 and 8414 with every
candidate URL tried and every failure reported; dynamic registration reused per `(project, issuer)`; PKCE and
`state`; `resource` on both the authorization and the token request; `selectScopes` as the one place the ask is
decided, adding `offline_access` back when the authorization server offers it; the `GET` return terminus that
reads nothing and bounces with no `next` parameter; and a callback that derives everything from the parked flow,
peeks before it collects, and re-checks admin inside the transaction.

`headers` hold non-credential headers only. A header named `authorization`, `proxy-authorization`, or `cookie`,
or any name matching `/(token|secret|key|auth)/i`, is refused with a hint to use the credential instead, so a
token cannot be stored in the one column that is serialized back.

Refresh is ToolExec's: `mcp-credentials:refresh` every five minutes fans out `mcp-credential:refresh` per
credential expiring within the window, each under a row lock with rotation committed atomically. A call also
refreshes lazily when its token expires within 60 seconds. A permanent refresh failure stamps `refreshFailedAt`,
marks the server `needsReauthAt`, and notifies admins.

### The client: pooled per worker, bounded everywhere

`McpClientOps` keeps one `Client` per `(serverId, url, transport, headersSha)` per worker process, LRU-capped at
64 and closed after five idle minutes. The token is not part of the key: the transport's `fetch` is a wrapper
that reads the current credential **per request**, so a refresh never forces a reconnect. The wrapper is
ToolExec's `boundedFetch` grown up — it calls `assertPublicUrl` on every request URL (the configured one and any
endpoint the server redirects the transport to), merges the call's `AbortSignal`, strips any `Authorization` the
transport set, attaches the credential, and records whether the request body was written, which the error
classifier needs. As in ToolExec, the SDK is never handed an `authProvider`: its built-in OAuth client assumes a
desktop that can open a browser and listen on loopback.

Bounds: 10 s to connect, 15 s per `tools/list` page, and a per-server `timeoutMs` for calls (default 60 s, max
180 s) with `resetTimeoutOnProgress` under a `maxTotalTimeout` of the same cap; the tick's lease signal aborts any
call when the lease is lost. Responses over 32 MiB are aborted. A streamable-HTTP `404` on a known session means
the server forgot it and did not process the request, so the client re-initializes and retries once. A server's
`notifications/tools/list_changed` enqueues a reindex. Edits to a server's URL, transport, or headers publish
`mcp:server:<id>:changed` after commit and every worker evicts its client.

A result is kept whole. v1's `formatCallToolResult` flattens `content` to text and drops `structuredContent`
entirely, so a tool's machine-readable answer never reaches the bot or a program. Here the full `CallToolResult`
is the call's recorded outcome (offloaded through [phase 8](./phase-0008-context-management.md) above its
threshold), and the bot sees `structuredContent` as JSON when present, otherwise the text blocks; image, audio,
and blob resources are written to the conversation's scratch path and referenced by logical path.

### The tool index

`mcp_tools` holds, per enabled server, every tool's name, title, description, schemas, annotations, and a
`schemaSha`. `mcp-server:index` rebuilds one server's rows (pagination followed, removed tools deleted) after any
create, edit, credential change, or `list_changed`, and `mcp-servers:reindex` re-runs it every six hours. Search is
the memory search shape from [phase 9](./phase-0009-memory-search-and-ingestion.md): a `tsvector` over name, title,
description, parameter names, and the server's admin description, plus a 384-d embedding computed on the `embed`
queue when `schemaSha` changes, fused with RRF. Results are filtered to the calling bot's servers and to tools not
disabled. The index is a search aid, not a source of truth — ToolExec's warning that a cached tool list is stale
the moment the upstream deploys still holds — so `mcp_info` and `mcp_exec` read the live list (cached in-process
for 60 s) and repair the row when its `schemaSha` differs.

A tool whose name equals a built-in bot tool is indexed with `shadowedByBuiltin` and is not callable. v1's
`dispatchMcpExec` already refuses a built-in name routed through `mcp_exec` and tells the model to call the tool
directly, because a model that can wrap a built-in in `mcp_exec` sometimes does; the same refusal applies here,
and the Settings page warns the admin which server tools a collision hides.

The system prompt names the servers a bot may use, one line each (name and the admin's description), sorted so the
prefix stays cache-stable. It never carries tool catalogs (the v1 rule from milestone 18: discover with
`mcp_search`, read the schema with `mcp_info`, never guess arguments) and never a server's own `instructions`,
which are a stranger's text.

### Errors are classified by structure, not by message

v1's `classifyMcpError` lower-cases the error string and searches it for `"auth"`, `"invalid"`, and `"429"`, so
an error mentioning an "author" is an auth failure. Classification here reads types and codes only:

| Signal | `error_kind` | Notes |
|---|---|---|
| `fetch` rejected with a system error code before the body was written | `retryable` | Connection refused, reset, DNS failure |
| HTTP 429 / 502 / 503 / 504 | `retryable` | `Retry-After` surfaces in the hint |
| HTTP 401, or 403 with `insufficient_scope` | — | Not an error: one forced refresh, then a `reconnect` gate (below) |
| JSON-RPC `-32602` | `input_error` | Hint: `mcp_info`, then retry with corrected arguments |
| JSON-RPC `-32601`, unknown tool, HTTP 404 | `not_found` | Hint: `mcp_search` |
| JSON-RPC `-32042` | — | URL elicitation gate (below) |
| JSON-RPC `-32001`, our deadline, a reset after the body was written | `timeout` | For an `unsafe` call this is **outcome unknown** ([phase 6](./phase-0006-durable-bot-loop.md)), never `retryable` |
| `CallToolResult.isError` | `tool_error` | The tool ran and reported failure; its content is returned |
| Not allowlisted, tool disabled, server disabled, SSRF refusal | `policy_error` | Hint names who can fix it |
| Denied or expired approval | `denied` | Hint: do not retry the same call |
| Anything else | `permanent` | |

### Replay is per call

`mcp_search`, `mcp_list_tools`, and `mcp_info` are `replay: safe`. `mcp_exec` decides per call at dispatch and
records it on the row: `safe` when the target's indexed annotations say `readOnlyHint: true`, otherwise `unsafe`.
`idempotentHint` is deliberately ignored — "create or update" tools claim it more often than they honour it — and
replay trusts `readOnlyHint` while approval does not (next section), because the stakes differ: replay re-runs, after
a crash, a call that was already allowed once; auto-allow decides whether a person is asked at all.

### The approval policy

Evaluated in the worker, in this order, before a call becomes `started`:

1. Server exists and is enabled; the bot is on its allowlist; the tool is not disabled and not shadowed;
   otherwise `policy_error` or `input_error`.
2. The tool exists in the live list and the arguments validate against its `inputSchema`; otherwise
   `input_error`. Validating first means nobody is asked to approve a call that cannot succeed.
3. If the server has `autoAllowReadOnly` and the tool says `readOnlyHint: true`, allow. Off by default, as in v1:
   annotations are a stranger's hints, and trusting them is a judgement about one server an admin makes once.
4. If any rule matches — project-wide (`botId` null) or for this bot — allow. Patterns are v1's
   `matchesAllowlist` verbatim; an invalid `/regex/`, which v1 silently ignores, is refused at write time.
5. Otherwise gate: the call goes `pending → awaiting_approval` and an `approvals` row is inserted with it.

There is no master switch and no `--unsafe`. A project that wants no gate adds the rule `*` — audited, visible, and
revocable — which is the honest form of the same decision.

### A gated call parks its conversation and runs exactly as recorded

The `tool_calls` row already holds server, tool, and arguments as the model emitted them. In one transaction the
call goes `awaiting_approval`, the `approvals` row is inserted, and notification rows are queued; after commit the
thread, bot, and `project:<id>:approvals` channels get content-free frames. Ungated calls from the same model step
run normally; the conversation is `waiting` until every call in the step has an outcome, because the next model
step needs a result for every tool call it made.

A decision is `UPDATE approvals SET status = … WHERE id = $1 AND status = 'pending' RETURNING …` — the first
decider wins and a second gets `409` naming who decided — and in the same transaction moves the call to `approved`
or `denied`, writes the audit row, and for "always allow" inserts the rule. After commit, `bot:tick` is enqueued;
`bots:dispatch` also treats a `waiting` conversation with no undecided calls as runnable, so the decision is
durable without the queue. Tick step 3 then runs the approved call with the row's arguments. Structural checks
(server enabled, bot allowlisted, tool not disabled) are re-run, because the decision approved a call, not a
configuration that has since changed; rules are not, because a person decided. A denial becomes the call's result:
`{ is_error: true, error_kind: "denied", decided_by, note, hint: "Do not retry this call…" }`.

Why park rather than return a placeholder: v1's `mcp_exec` returns "queued for human approval" and tells the model
to call `wait_task`; the task parks, and approval re-runs it from the top, repeating every ungated side effect made
before the gate — v1's own approvals doc warns about exactly that. A parked
conversation does not answer new messages in that thread until the gate resolves (they queue in its inbox, per
[phase 7](./phase-0007-threads-and-web-chat.md)); the thread shows the approval card at the parked call, so the
person waiting is looking at the reason and, if they have write on the bot, at the button. Other threads are other
conversations and are unaffected.

**Who may decide:** anyone with write on the bot, checked inside the deciding transaction (fresher than
middleware, the ToolExec gateway-callback lesson). Bots have no approval tool. "Always allow" defaults to a rule for
this bot; admins may choose project-wide. **Who is notified:** the person whose message started the turn, if they
have write on the bot, plus holders of the bot's `approvalNotifyTag`, or project admins when it is null — each
filtered through `canWriteBot` at notify time, ToolExec's lesson that a notify tag must never route around access.
**Expiry:** `approvals:expire` marks rows `expired` past `expiresAt` (project setting, default 72 h) and the call is
denied with reason `expired`, so a forgotten approval ends a wait rather than holding it forever.

### Elicitation and re-authorization are approvals too

v1 drops both. Each becomes an `approvals` row with its own `kind`, decided through the same inbox, actions, and
CLI:

- **`url_elicitation`** — the server answered `-32042` with URLs a person must visit. The error means the server
  did not execute the request, so the call goes `started → awaiting_approval` (the one legal backwards edge, used
  only when the server guarantees no effect). The card shows the URL with its host prominent; "Done" approves and
  the recorded call re-runs; "Cancel" denies.
- **`reconnect`** — a `401`, or a `403` with `insufficient_scope`, survived one forced refresh (or there is no
  credential). The server stamps `needsReauthAt`, admins are notified, and the call parks with the required scopes
  in the payload. Completing OAuth or pasting a new key resolves every pending `reconnect` gate on that server as
  approved by that admin, and the calls run. A writer of the bot may deny.
- **`form_elicitation`** — `elicitation/create` mid-call. The server is waiting, so this is the one gate that holds
  the tick: the client waits up to `elicitationWaitSeconds` (default 120 s, capped by the tick budget, lease renewed)
  for a person to answer the rendered schema. An answer is encrypted onto the row, read once by the worker, sent as
  `accept`, and erased; a deny sends `decline`; no answer sends `cancel` and the row expires. Form capability is
  advertised only on streamable-HTTP clients, where the transport ties the request to the call that caused it; an
  elicitation the client cannot attribute is answered `cancel` and reported to admins.

### What a server says is fenced

Every MCP-derived string reaching the model — results, tool titles and descriptions (capped at 300 characters in
search, 4 KB in `mcp_info`), elicitation messages — is wrapped by [phase 6](./phase-0006-durable-bot-loop.md)'s
provenance fence (`mcp:<server>/<tool>`, call id) as data. Tool descriptions are included deliberately: a poisoned
description is the cheapest injection a hostile server has. In the UI, server text is labelled as coming from the
server and links are never auto-opened.

## Decisions

| Question | Decision |
|---|---|
| Who manages servers, credentials, and allowlists | Project admins only; members read servers and tools |
| Default allowlist of a new server | No bots; `allBots` is an explicit, audited checkbox |
| Read-only auto-allow | Per server, `autoAllowReadOnly`, default off (v1 parity) |
| Replay classification | `readOnlyHint: true` → safe; everything else unsafe; `idempotentHint` ignored |
| Deny rules | None; admins disable tools per server, and anything unmatched is gated |
| Scope of "always allow" | This bot by default; project-wide for admins |
| Approval expiry | Project setting, default 72 h, min 1 h, max 30 d |
| Human messages while a conversation waits on approval | Queue; the approval card in the thread is the affordance |
| Decisions over MCP for human OAuth clients | Never — an MCP client is itself a model; deciding is for people through rendered surfaces |
| Notifications channel | Browser via phase 7; Slack in phase 16, iMessage in phase 17 |
| Form elicitation wait | 120 s default, project setting, max 240 s; streamable HTTP only |

**Open question:** whether the SDK exposes the related request id for server-to-client requests on streamable
HTTP in the version pinned at build time. If it does not, form elicitation ships disabled and URL elicitation
(which is always attributable, being an error on the request itself) ships alone.

## Steps

### 1. Schema — `backend/schema/{mcp_servers,mcp_server_bots,mcp_credentials,oauth_client_registrations,mcp_tools,mcp_approval_rules,approvals}.ts`

`mcp_servers`:

| Column | Notes |
|---|---|
| `projectId` | → `projects.id`, cascade |
| `name` | `varchar(48)`, `^[a-z][a-z0-9_-]*$` (no `/` or `*`, which patterns use); unique per project |
| `description` | `text` — admin-written; shown to bots in the roster and searched |
| `url`, `transport` | `text`; `varchar`: `http` \| `sse`, default `http` |
| `headers` | `jsonb` `Record<string,string>`, non-credential only (validated) |
| `enabled`, `allBots`, `autoAllowReadOnly` | `boolean`; defaults `true`, `false`, `false` |
| `disabledTools` | `jsonb` `string[]`, rule-pattern syntax |
| `timeoutMs` | `integer`, default 60000, max 180000 |
| `serverInfo`, `instructions` | `jsonb`, `text` — last seen at index time; admins only, never bots |
| `lastIndexedAt`, `lastIndexError`, `needsReauthAt` | nullable |
| `createdByUserId`, `createdAt`, `updatedAt` | |

`mcp_server_bots`: `projectId`, `mcpServerId` (cascade), `botId` (cascade); primary key `(mcpServerId, botId)`.

`mcp_credentials`: `gateway_credentials` column for column, renamed `mcpServerId` (unique, cascade), plus
`projectId` (cascade), `apiKeyHeader` (default `Authorization`), `apiKeyScheme` (default `Bearer`, empty for raw),
and `connectedByUserId`. `oauth_client_registrations` is ported unchanged.

`mcp_tools`: `projectId`, `mcpServerId` (cascade), `name` (`varchar(128)`), `title`, `description`, `inputSchema`,
`outputSchema`, `annotations` (`jsonb`), `readOnly` and `shadowedByBuiltin` (`boolean`), `schemaSha`,
`searchText` (`tsvector`, generated), `embedding` (`vector(384)`, nullable), `embeddingRevision`, `indexedAt`.
Unique `(mcpServerId, name)`; GIN on `searchText`; HNSW on `embedding`.

`mcp_approval_rules`: `projectId`, `botId` (nullable, cascade; null = project-wide), `pattern` (`varchar(256)`),
`source` (`manual` \| `always_allow`), `createdFromApprovalId` (nullable), `note`, `createdByUserId`,
`createdAt`. Unique `(projectId, botId, pattern)` with `NULLS NOT DISTINCT`.

`approvals`:

| Column | Notes |
|---|---|
| `projectId`, `botId`, `conversationId`, `threadId` | cascade |
| `toolCallId` | → `tool_calls.id`, cascade |
| `kind` | `call` \| `url_elicitation` \| `form_elicitation` \| `reconnect` |
| `status` | `pending` \| `approved` \| `denied` \| `expired` |
| `mcpServerId`, `toolName` | the call's target (server nullable, set null) |
| `reason` | e.g. `not_allowlisted`, `insufficient_scope` |
| `payload` | `jsonb` — elicitation message, URL, `elicitationId`, requested schema, required scopes; a direct call's arguments stay on the call (only [phase 11](./phase-0011-code-mode.md)'s program gates copy them here); never secrets |
| `answerCiphertext`, `answerIv`, `answerAuthTag` | form answers only; nulled once delivered |
| `expiresAt`, `requestedAt` | |
| `decidedByUserId`, `decidedAt`, `decisionScope`, `decisionNote`, `decidedVia`, `ruleId` | `decisionScope`: `once` \| `always_bot` \| `always_project`; `decidedVia`: `web` \| `cli` \| `slack` \| `imessage` |

Indexes `(projectId, status, requestedAt)` for the inbox, `(toolCallId)`, and a partial unique
`(toolCallId, kind) WHERE status = 'pending'`. Also: `bots.approvalNotifyTag text`, and project settings
`approvalTtlHours` and `elicitationWaitSeconds` (on the project settings row in ToolExec's
`toolexec:backend/schema/project_settings.ts` shape; this phase creates it if no earlier phase has).

### 2. Config — `backend/config/mcp.ts`

`poolMaxClients` (64), `poolIdleMs` (300000), `connectTimeoutMs` (10000), `listTimeoutMs` (15000),
`maxCallTimeoutMs` (180000), `maxResponseBytes` (32 MiB), `toolInfoCacheMs` (60000), `credentialRefreshWindowMs`,
and `allowPrivateHosts` (false in production, true elsewhere — ToolExec's switch, so the suite's fake servers on
loopback work).

### 3. Ops — `backend/ops/`

- `NetworkGuardOps`, `OAuthClientOps`, `McpProbeOps` — ported; probe gains nothing but the rename.
- `McpCredentialOps` — `GatewayCredentialOps` ported: `putCredential`, `currentAuth(serverId)` (refreshing when
  within the window), `refreshCredential` (row lock, rotation in one transaction), `markRefreshFailed`.
- `McpServerOps` — `validateHeaders`, `canBotUse(server, botId)`, `serializeServer` (credential status only).
- `McpClientOps` — `withClient(server, fn)`, the pool, `boundedFetch`, `callTool(server, tool, args, signal)`
  returning a typed outcome, `classifyMcpError` per the table, `renderResult`.
- `McpIndexOps` — `indexServer(serverId)`, `searchTools(projectId, botId, query, {mode, limit})`, `liveTool`.
- `McpPolicyOps` — `matchesPattern` (v1's `matchesAllowlist`), `validatePattern`, `evaluate(bot, server, tool,
  args)` → `allow` \| `gate` \| refusal; `replayFor(tool)`.
- `ApprovalOps` — `createGate`, `decide(tx, approvalId, user, decision, scope, note, answer?)`,
  `resolveReconnectGates(serverId, user)`, `expireDue`, `resolveApprovers`, `serializeApproval`.

### 4. Actions — `backend/actions/{mcp-server,mcp-credential,mcp-oauth,mcp-tool,approval,approval-rule}/*.ts`

| Action | Route | RBAC | Audited | MCP |
|---|---|---|---|---|
| `mcp-server:create` / `:edit` / `:delete` | `PUT` / `POST` / `DELETE /mcp-server` | admin | yes | never — changes what every allowlisted bot can reach (ToolExec makes the same call for gateways) |
| `mcp-server:list` / `:view` | `GET /mcp-servers`, `GET /mcp-server` | member | — | yes |
| `mcp-server:probe` | `POST /mcp-server/probe` | admin, rate-limited | no (writes nothing) | never |
| `mcp-credential:put` / `:delete` | `PUT` / `DELETE /mcp-server/credential` | admin, `secret()` | yes | never |
| `mcp-oauth:start` | `PUT /mcp-server/oauth/start` | admin | yes | never |
| `mcp-oauth:return` | `GET /mcp-server/oauth/callback` | none; reads and writes nothing | no | never |
| `mcp-oauth:callback` | `POST /mcp-server/oauth/callback` | session; admin re-checked in the transaction | yes | never |
| `mcp-tool:list` | `GET /mcp-tools` (`serverId`, `q`, paginated) | member | — | yes |
| `approval:list` / `:view` | `GET /approvals`, `GET /approval` | member; rows for bots the caller can read | — | yes |
| `approval:approve` / `:deny` | `POST /approval/approve`, `/approval/deny` | member; `canWriteBot` in the transaction (`reconnect` approve: admin) | yes | never |
| `approval-rule:create` / `:delete` | `PUT` / `DELETE /approval-rule` | `canWriteBot` for bot rules, admin for project rules | yes | never |
| `approval-rule:list` | `GET /approval-rules` | member | — | yes |

### 5. Clocks / tasks — `backend/actions/{mcp-credential,mcp-server,approval}/*.ts`

All task-only, no `web` route: `mcp-credentials:refresh` (5 min, `orchestrator`) → `mcp-credential:refresh`
(`default`); `mcp-servers:reindex` (6 h, `orchestrator`) → `mcp-server:index` (`default`, also enqueued after
commit by create, edit, credential changes, and `list_changed`); `approvals:expire` (60 s, `orchestrator`).

### 6. Bot tools — `backend/bots/tools/mcp/{search,list-tools,info,exec}.ts`

| Tool | Description tag | Replay | Inputs |
|---|---|---|---|
| `mcp_search` | `[[ bash equivalent command: apropos <query> ]]` | safe | `query`, `server?`, `mode?` (`hybrid` \| `keyword` \| `semantic`), `limit?` (≤ 20) |
| `mcp_list_tools` | `[[ bash equivalent command: ls ]]` | safe | `server?`, `limit?`, `offset?`; with no server, the bot's servers and tool counts |
| `mcp_info` | `[[ bash equivalent command: man <tool> ]]` | safe | `server`, `tool` → schemas, annotations, `read_only`, `needs_approval` for this bot, a generated signature |
| `mcp_exec` | none — no faithful bash analogue, and a misleading tag is worse than none | per call | `server`, `tool`, `args` |

Search results carry `read_only` and `needs_approval` so a bot can plan around a gate before it hits one. Every
failure is a PATs envelope — `is_error`, `error_kind`, `message`, `next_action_hint` — and a `policy_error` names
the person who can fix it ("a project admin can add this bot to `github`").

### 7. Frontend — `frontend/src/components/settings/sections/McpServersSection.tsx`, `frontend/src/pages/{ApprovalsPage,McpOAuthReturnPage}.tsx`

The Settings section lists servers with credential status, tool count, and the probe report (ported
`ProbeReport`), and edits URL, transport, headers, the bot allowlist, disabled tools, read-only trust, and timeout;
"Connect" runs OAuth, "Paste key" puts an API key, and shadowed tools are flagged. `ApprovalsPage` follows
`HelpInboxPage`: pending first, filters by bot and kind, live on `project:<id>:approvals`. `ApprovalCard` is
shared by the inbox and the chat transcript, where it renders at the parked call: bot, thread, server/tool, the
server's annotations labelled as the server's claims, the full arguments, and the buttons the caller may use —
"Approve once", "Always allow for this bot", "…for every bot" (admins), "Deny" with a note; a `SchemaForm` for
form elicitations; URL and host for URL elicitations. The bot page lists the servers the bot may use and its
bot-scoped rules.

### 8. CLI — `cli/src/commands/{mcp,approval}.ts`

| Command | Wraps |
|---|---|
| `botholomew mcp list` / `view <name>` | `mcp-server:list` / `:view` |
| `botholomew mcp add <name> <url> [--transport sse] [--header K=V]… [--bot <slug>]… [--all-bots]` | `mcp-server:create` |
| `botholomew mcp edit <name> …` / `remove <name>` / `probe <name>` | `:edit` / `:delete` / `:probe` |
| `botholomew mcp connect <name>` | `mcp-oauth:start`; prints and opens the authorization URL |
| `botholomew mcp key <name>` | `mcp-credential:put`; the key is read from stdin, never argv |
| `botholomew mcp tools [<name>] [--search <q>]` | `mcp-tool:list` |
| `botholomew mcp rule list` / `add <pattern> [--bot <slug>]` / `remove <id>` | `approval-rule:*` |
| `botholomew approval list [--status] [--bot] [-l] [-o]` / `view <id>` | `approval:list` / `:view` |
| `botholomew approval approve <id> [--always bot\|project] [--note] [--field k=v]…` / `deny <id> [--note]` | `approval:approve` / `:deny` |

### 9. User docs — `frontend/src/content/docs/{mcp-servers,approvals}.md`

New pages for servers (transports, OAuth vs key, the allowlist, disabled tools, the probe) and approvals (default
deny, rule syntax, what parks and what does not, elicitation, expiry, who decides). Update `security.md` (SSRF,
credentials never reach bots or code mode), `bots.md` (servers per bot), `mcp.md` (what human clients can read and
why they cannot decide), and `cli.md`.

### 10. Tests — `backend/__tests__/`

A fake MCP server (`helpers/fakeMcpServer.ts`, `Bun.serve` with the SDK's server over streamable HTTP and SSE)
exposes scripted tools — `echo`, `structured`, `slow`, `flaky`, `big`, `url_elicit`, `form_elicit`, `whoami` —
and an optional fake authorization server; [phase 6](./phase-0006-durable-bot-loop.md)'s fake model server drives
bots.

- `actions/mcp-server.test.ts` — admin-only writes; credential-looking headers refused; a metadata address refused
  with `allowPrivateHosts` off; responses never contain a token (assert against a known secret); writes not
  MCP-published.
- `actions/mcp-oauth.test.ts` — the full round trip over HTTP: `401` → RFC 9728 → 8414 → registration → PKCE →
  return `302` with no `next` → callback (peek before collect; a second callback fails); `resource` on token and
  refresh requests; rotation under concurrent refresh; permanent failure stamps `refreshFailedAt` and notifies.
- `actions/mcp-server-probe.test.ts` — never throws, never writes, fallback reported not applied, wall clock bounded.
- `mcp/client.test.ts` — pooled reuse; refresh without reconnect; eviction on edit; session `404` re-init;
  `structuredContent` reaches the bot; `big` aborts at the cap; every request (including a redirect) is guarded.
- `mcp/index.test.ts` — index, `list_changed` reindex, keyword and fake-embedder semantic search, allowlist and
  `disabledTools` filtering, `shadowedByBuiltin`.
- `bots/mcp-tools.test.ts` — envelopes; the classification table driven from real fake-server responses; a body
  written then reset on an unsafe tool yields outcome unknown; `memory_write` via `mcp_exec` refused with a hint.
- `actions/approval.test.ts` — rule matching (exact, wildcards, bare, regex, invalid regex refused); default deny;
  park → `waiting`; approve → the fake server receives byte-identical arguments, **once**, with no extra model
  request; deny → `denied` result; parallel calls (ungated run, gated wait); concurrent decide (one wins, `409`);
  non-writer `403`; "always allow" inserts an audited rule; expiry denies; a crash between approve and execute runs
  the call once; recipients filtered by `canWriteBot`.
- `mcp/elicitation.test.ts` — `-32042` parks, "Done" re-runs the recorded call; form answered in the window reaches
  the server as `accept` and is erased; unanswered → `cancel`; `401` mid-call → `reconnect` gate → reconnect
  resolves it and the call runs.
- `bots/fencing.test.ts` — an injection string in a result and in a tool description appears only inside a fence.
- `frontend/e2e/approvals.spec.ts` — two contexts: a gated call shows the card in the thread and the bell
  increments without reload; approving in the other context resumes the bot.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

End to end with a real remote server (a GitHub or Linear MCP endpoint that speaks OAuth) and **two browser
windows**, one as admin and one as a member with write on the leader:

1. As admin, add the server in Settings. The probe reports `auth_required` with an issuer; "Connect" completes
   OAuth and the row shows `connected as …` and a tool count. Allow the leader only.
2. As the member, ask the leader to list open issues. It calls `mcp_search`, `mcp_info`, then `mcp_exec`; the call
   is gated, the thread shows the card, and the admin's bell increments without a reload.
3. Approve once from the thread. The issues arrive; the transcript shows one call, attributed to the approver.
4. Ask it to comment on an issue; choose "Always allow for this bot". The comment posts; the rule appears in the
   bot's rules and the audit log.
5. Ask a worker bot that is not on the allowlist to do the same; it answers with the `policy_error` hint.

Then the edge cases:

- Deny a call: the bot says it was declined and does not retry it.
- Leave a gate past a 1-hour TTL: it expires, the bot continues, nothing hangs.
- Revoke the token at the provider: the next call parks as `reconnect`, admins are notified, reconnecting runs it.
- Point a server at `http://169.254.169.254/` in a production-config run: refused at save and at call time.
- `botholomew approval list` and `approve` drive the same flow from a terminal.

## Definition of done

- [ ] Seven tables with the constraints above; no credential column is ever serialized
- [ ] Remote `http` / `sse` only; credential-looking headers refused; SSRF guard on every request
- [ ] OAuth, API-key, and none modes; refresh clock with rotation; reconnect notifications
- [ ] Pooled client with bounded connect, list, and call; session recovery; `structuredContent` preserved
- [ ] Tool index with keyword and semantic search, live-repaired; built-in collisions refused
- [ ] `mcp_search`, `mcp_list_tools`, `mcp_info`, `mcp_exec` with structural classification and per-call replay
- [ ] Policy: allowlist, disabled tools, opt-in read-only, v1 patterns, project and bot rules
- [ ] Gated calls park the conversation; approve runs the recorded arguments once with no model call; deny and
      expiry produce `denied`
- [ ] URL elicitation, form elicitation, and reconnect routed to people as approvals
- [ ] Provenance fencing on results, descriptions, and elicitation text
- [ ] Settings section, approvals inbox, inline cards, CLI, and user docs
- [ ] Tests listed above pass twice consecutively

## Commands

```bash
botholomew mcp add github https://api.example.com/mcp --bot botholomew
botholomew mcp connect github            # opens the authorization URL
botholomew mcp probe github
botholomew approval list --status pending
botholomew approval approve 42 --always bot

# Ticks by hand (ops CLI, local Postgres)
cd backend && bun keryx.ts mcp-credentials:refresh
cd backend && bun keryx.ts approvals:expire
```

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
