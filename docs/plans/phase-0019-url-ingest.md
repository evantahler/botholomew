# Phase 19 — URL ingest

> **Goal:** A person or a bot hands project memory a public URL, and the page or document behind it lands as a
> markdown file at `remotes/<host>/<path>` with its provenance attached — fetched once, by the server, through a
> guard that will not reach anything but the public internet.

> **Status: planned, not built.** Stage F — Memory, later. Depends on
> [phase 4](./phase-0004-project-memory-core.md) (versions and the reserved source columns),
> [phase 6](./phase-0006-durable-bot-loop.md) (provenance fencing), [phase 9](./phase-0009-memory-search-and-ingestion.md)
> (sniffing, converters, ingest jobs, `memory:add`, `memory_add`), and
> [phase 10](./phase-0010-mcp-servers-and-approvals.md) (the ported `NetworkGuardOps`).

[Phase 9](./phase-0009-memory-search-and-ingestion.md) stops at uploads for a reason: until now the server never
reaches out. Every byte in project memory arrived in a request body. Adding from a URL is the first time the
server fetches an address somebody *typed* — and, worse, an address a bot chose, possibly because a page it read
told it to. That is server-side request forgery in its textbook shape with a prompt-injection delivery mechanism
attached, so this phase is mostly about the fetch and only a little about the feature.

membot never had this. Its [plan](https://github.com/evantahler/membot/blob/main/docs/plan.md) is explicit that
there is "no generic-web catch-all": an unclaimed URL is an error telling the user to download the file. That is
right for a local CLI and wrong for a cloud service whose bots have no disk. v1 tried the opposite —
[milestone 8](https://github.com/evantahler/botholomew/blob/v1/docs/plans/milestone-8-remote-context.md) had a
model loop *choose* how to fetch each URL — and
[milestone 13](https://github.com/evantahler/botholomew/blob/v1/docs/plans/milestone-13-replace-context-with-membot.md)
removed it for membot's deterministic downloaders. 2.0 takes the middle: one deterministic public fetcher, plain
HTTP, no browser, no model in the loop, behind a guard.

A URL is fetched **once** here; keeping it current is [phase 20](./phase-0020-upstream-refresh.md). Anything that
needs a credential — a private GitHub issue, a Google Doc — goes through an MCP-backed router in
[phase 21](./phase-0021-source-routers-and-bulk-sync.md), never through headers or cookies on this fetcher.
Scanned-PDF conversion waits for [phase 22](./phase-0022-llm-assisted-ingestion.md); the fetched bytes are dropped
after conversion, and image URLs refused, until [phase 23](./phase-0023-original-bytes-and-blob-policy.md) keeps
originals.

## Scope

**In:** `MemoryFetchOps` — a pinned, redirect-checking, port-restricted, size- and time-capped public `GET`; an
HTML signature added to phase 9's `sniffMime`; HTML → markdown through turndown with membot's cleaning, plus
`<title>` promotion; every other supported mime through phase 9's converters; the `remotes/<host>/<path>` default
and a refusal to overwrite a path owned by another source; phase 4's reserved source columns filled
(`sourceType = 'url'`, `sourceUri`, `sourceSha256`, `sourceMimeType`) plus `sourceFinalUri`, `fetchedAt`,
`sourceEtag`, `sourceLastModified`, `fetcherArgs`, and the carried-forward `untrusted` flag; URL jobs on
`memory_ingest_jobs` and a `memory:fetch` task; `memory:add` and `memory_add` accepting `url`; fencing of fetched
content in every bot read path; per-project and per-host rate limits; the "Add from URL" dialog;
`botholomew memory add <url>`; user docs; tests against a local fixture server.

**Out:** scheduled refresh ([phase 20](./phase-0020-upstream-refresh.md)); authenticated sources, bulk import, and
sync ([phase 21](./phase-0021-source-routers-and-bulk-sync.md)); model-assisted conversion
([phase 22](./phase-0022-llm-assisted-ingestion.md)); keeping fetched bytes and accepting image URLs
([phase 23](./phase-0023-original-bytes-and-blob-policy.md)). Never: a headless browser or JavaScript rendering,
link-following or crawling, cookies, caller-supplied headers.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| `assertPublicUrl` / `isPublicIpAddress` | Judge the address, not the hostname; the IANA special-purpose table; embedded-IPv4 unwrapping; fail-closed DNS; the cloud-metadata list. Its JSDoc names DNS rebinding and redirects as the residuals this phase closes | `toolexec:backend/ops/NetworkGuardOps.ts`, ported by [phase 10](./phase-0010-mcp-servers-and-approvals.md) |
| The guard's suite | An exhaustive table test of the pure range check | `toolexec:backend/__tests__/ops/network-guard.test.ts` |
| Re-check per request | `boundedFetch` guards every URL an upstream names, not only the configured one | `toolexec:backend/ops/McpProbeOps.ts` |
| Capped reads | Read one byte past the cap, so *at* and *over* the limit differ | `toolexec:backend/ops/RawRequestOps.ts` |
| HTML → markdown | turndown (ATX, fenced code, `-` bullets) after stripping `script` / `style` / `noscript` | [src/ingest/converter/html.ts](https://github.com/evantahler/membot/blob/main/src/ingest/converter/html.ts) |
| Default URL path | `defaultLogicalForUrl`: `remotes/{host}/{pathname}`, query and fragment dropped, full URL kept for refresh | [src/ingest/ingest.ts](https://github.com/evantahler/membot/blob/main/src/ingest/ingest.ts) |
| Replayable fetch identity | `downloader` + `downloader_args` persisted per version so refresh can replay | [src/ingest/sources/types.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/types.ts) |
| Reserved source columns, `MemoryOps`, `canWritePath` | `sourceType` (`url` and `router` reserved), `sourceUri`, `sourceSha256`, `sourceMimeType`; the one write funnel | [phase 4](./phase-0004-project-memory-core.md) |
| `sniffMime`, converters, `memory_ingest_jobs`, `memory:ingest`, `memory:add`, `memory_add` | Everything after the bytes arrive, including `requestId` idempotency | [phase 9](./phase-0009-memory-search-and-ingestion.md) |
| `<untrusted>` fencing | `fenceUntrusted(text, provenance)`; "fetched pages" already named as a fenced source | [phase 6](./phase-0006-durable-bot-loop.md) |

## What this must not weaken

1. **In production the server never connects to a non-public address** — judged on the address actually
   connected to, at every redirect hop.
2. **A fetch carries no authority.** No cookie, `Authorization`, project secret, or caller-supplied header ever
   rides on it; anything needing a credential is a [phase 21](./phase-0021-source-routers-and-bulk-sync.md) router.
3. **Fetched text is data, never instruction**: fenced in every bot read path, and never written into `skills/`,
   `prompts/`, or `bots/<slug>/prompts/`.
4. **No model decides how to fetch.** v1's milestone 8 is the counter-example.
5. **Append-only and attributed.** A fetch is a new version through `MemoryOps`, authored by whoever asked.
6. **Every human decision is audited**; a bot's fetch is its `tool_calls` row.

## Design

### The guard moves into the connection

`assertPublicUrl` resolves a name, judges every address, and then lets `fetch` resolve again. Between the two a
one-second TTL can change the answer — DNS rebinding — and ToolExec accepted that because its input was a gateway
URL an admin typed. Here the input is any URL any member or bot supplies, so the window is closed:

- **One resolution, judged and used.** `guardedFetch` connects through `node:http(s)` with a `lookup` hook that
  resolves, runs every address through `isPublicIpAddress`, refuses if *any* is non-public (a mixed answer is the
  round-robin bypass ToolExec names), and hands the socket the address it judged. There is no second lookup to
  race. If Bun's `node:https` ever ignored `lookup`, that would be a Bun bug to report upstream, not a reason to
  fall back to resolve-then-fetch; the rebinding test below is the tripwire.
- **Redirects by hand.** `redirect: "manual"`, at most five hops, each `Location` resolved against the current URL
  and judged again in full. An `https` → `http` hop is refused: nothing secret rides the request, but a downgrade
  lets an on-path party substitute the document.
- **Scheme and port.** `http` and `https`; ports 80 and 443 only. A public-only guard still lets a caller probe a
  third party's admin ports through us; restricting ports costs no real document anything.
- **Development.** `fetchAllowPrivateHosts`, off in production and on elsewhere (the fixture server is on
  loopback) — a switch separate from phase 10's, so relaxing the gateway guard never silently relaxes this one.

### Caps, sniffing, and conversion

The body streams and **decoded** bytes are counted, stopping one byte past phase 9's 25 MiB upload cap — counting
wire bytes would let a 50 KB gzip bomb inflate to gigabytes. Time is capped at connect (5 s), first byte (10 s),
and total (30 s) through one `AbortSignal`.

The bytes then go where an upload's go. Phase 9's `sniffMime` already lets magic bytes beat `Content-Type`; this
phase adds an HTML signature (`<!doctype html` / `<html` in the first KB), because servers send HTML as
`text/plain` and `application/octet-stream` often enough to matter. Anything phase 9 refuses — images, audio,
video, unknown binaries — is refused with the same hint, and the job fails without staging a payload. HTML goes through turndown
with membot's stripping, plus two additions: the `<title>` becomes the H1 when the body has none (so phase 9's
title-derived describer has something to use), and `<link rel="canonical">` is recorded in `fetcherArgs` but
**not followed** — following it would be a second fetch nobody asked for.

The request identifies itself (`User-Agent: Botholomew/<version> (+https://botholomew.com/bot)`) and does not
read `robots.txt`: that file governs crawlers, and a one-shot fetch a person or bot asked for, with no
link-following, is a user agent's request. [Phase 20](./phase-0020-upstream-refresh.md) revisits that for schedules.

### Paths, collisions, and provenance

The default path is membot's `remotes/<host>/<pathname>` (trailing slash trimmed, empty path `index`, query and
fragment dropped), validated by phase 4's path rules. Dropping the query means `?id=1` and `?id=2` share a path, so
the add **refuses to write over a current file whose `sourceUri` differs** — or that has none, such as a note a
person wrote — naming the owner and hinting `logical_path` or `replace`. A caller-supplied path may point
anywhere except the reserved namespaces: fetched text in `prompts/` would be a web page loaded into every bot's
system prompt, and no flag overrides that.

`memory_files` records `sourceType = 'url'` and the reserved `sourceUri` / `sourceSha256` / `sourceMimeType`
(phase 4 reserved `url` and `router`; membot called the same thing `remote`). `fetcherArgs` holds what a replay
needs beyond the URL, which for a plain fetch is little — routers fill it in phase 21 — and `sourceEtag` /
`sourceLastModified` are stored now so [phase 20](./phase-0020-upstream-refresh.md) can send conditional requests.

Every version a fetch writes has `untrusted = true`. When a bot reads it through `memory_cat`, `memory_search`
snippets, `memory_diff`, or code mode's `memory.readText` / `readJson`, phase 6's `fenceUntrusted` wraps it with
`source="url:<host>"` and the fetch time; a code-mode run that read untrusted content has its own result fenced.
The flag is carried forward by `edit`, `cp`, `mv`, and `restore` from an untrusted version, and by a bot's
`write` over one — a bot rewriting a page it read is laundering it. A person's full `write` clears it: they
authored the whole content. The residual, stated: a bot that copies a fenced page's words into a *different* file
launders them, and fencing cannot follow that. Fencing is mitigation; the structural controls are phase 10's gate
and the reserved-path refusal.

### One job, two callers

`memory:add` with `url` inserts a `memory_ingest_jobs` row carrying `sourceUri` and no payload, and returns it.
`memory:fetch { jobId }` runs on `default` — network waits never occupy the CPU-bound `embed` queue — fetches,
checks the path again, stores the bytes as the job's payload, and enqueues phase 9's `memory:ingest`, which
converts, describes, and writes through `MemoryOps` with `operation = 'ingest'` exactly as for an upload. Progress
arrives on `project:<id>:memory` frames; failures use phase 9's retry.

A bot's `memory_add url` fetches **inline** and, like phase 9's `content`, converts in the call when the body is
under 1 MiB, returning `{ logical_path, version_id }`; a larger body is queued and the result says so, with
`memory_info` showing the pending job. Its `requestId` is the tool call id, so a replay finds its job instead of
fetching twice — `replay: safe`. `fetchPerProjectPerMinute` (30) and `fetchPerHostConcurrency` (2) apply to both
callers, so the service cannot be used to hammer someone else's site.

## Steps

### 1. Schema — `backend/schema/{memory_files,memory_ingest_jobs}.ts`

`memory_files` gains (the reserved `sourceType` / `sourceUri` / `sourceSha256` / `sourceMimeType` need no change):

| Column | Type | Notes |
|---|---|---|
| `sourceFinalUri` | `text` | After redirects; shown, never replayed |
| `fetchedAt` | `timestamp(withTimezone)` | When the bytes were read |
| `sourceEtag`, `sourceLastModified` | `text` | For [phase 20](./phase-0020-upstream-refresh.md)'s conditional requests |
| `fetcherArgs` | `jsonb` | Canonical URL here; router id and vars in [phase 21](./phase-0021-source-routers-and-bulk-sync.md) |
| `untrusted` | `boolean not null default false` | Carried forward as described |

Index `(projectId, sourceUri) WHERE isCurrent` for the collision check. `memory_ingest_jobs` gains `sourceUri`,
`httpStatus`, and `fetchedAt`; a URL job is `queued` with a null payload until `memory:fetch` fills it.

### 2. Config — `backend/config/memory.ts`

`fetchConnectTimeoutMs` (5 000), `fetchFirstByteTimeoutMs` (10 000), `fetchTimeoutMs` (30 000),
`fetchMaxRedirects` (5), `fetchAllowedPorts` (`[80, 443]`), `fetchAllowPrivateHosts` (false in production),
`fetchUserAgent`, `fetchPerProjectPerMinute` (30), `fetchPerHostConcurrency` (2); the byte cap is phase 9's
`uploadMaxBytes`.

### 3. Ops — `backend/ops/MemoryFetchOps.ts`

- `guardedFetch(url, { signal, conditional? })` — pinned lookup, manual redirects, scheme/port checks, decoded
  cap; returns `{ bytes, finalUrl, status, headers, hops }`; refusals name the address and the hop.
- `defaultRemotePath(url)` — membot's convention through phase 4's validator.
- `assertPathAvailable(tx, projectId, path, sourceUri, { replace })` — the collision refusal.
- `runFetchJob(jobId)` — claim, fetch, payload, enqueue `memory:ingest`; idempotent on a job past `queued`.
- `setResolverForTesting(fn)` — returns chosen addresses; restore in `afterEach`.

Phase 9's `sniffMime` gains the HTML signature; its HTML converter gains `<title>` promotion.

### 4. Actions — `backend/actions/memory/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory:add` (phase 9) gains `url`, `replace`, `preview` | `PUT /memory/add` | member + `canWritePath` | yes, unless `preview` | yes |
| `memory:fetch` | — (task-only, `default`) | — | no — the job and version are the record | no |

`url` is exclusive with `content` / `contentBase64`. `preview: true` runs the guard and path resolution without
fetching and returns `{ logicalPath, collision }` for the dialog. `memory:jobs`, `memory:job`, and
`memory:job-retry` show URL jobs unchanged.

### 5. Bot tools — `backend/bots/tools/memory/add.ts`

`memory_add` gains `url` and `replace`, and `logical_path` becomes optional when `url` is given; it keeps phase 9's decision of no bash tag — the URL
form alone would be `wget -O`, but the tool is not. Errors use phase 10's `error_kind`s: `policy_error` for a
refused address or reserved path, `input_error` for an unsupported type or an owned path (naming the owner),
`not_found` for 404 / 410, `retryable` for 429 and 5xx with any `Retry-After`, `timeout`, and `permanent` for an
oversized body. `memory_cat`, `memory_search`, and `memory_diff` fence untrusted versions.

### 6. Frontend — `frontend/src/components/memory/AddFromUrlDialog.tsx`

An **Add from URL** button beside upload on the Memory page. The dialog takes a URL and optional path, calls
`preview` as the person types (debounced) to show where it will land or whose file it would replace, and on submit
shows the job in phase 9's list. The info panel gains a **Source** block — URL, final URL, fetch time, mime — and
an "untrusted (fetched)" badge.

### 7. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory add <url…> [--path p] [--replace] [--note n] [--wait]` | Arguments matching `^https?://` go to `memory:add` as `url` (phase 9 refused them with a hint); everything else is still walked and uploaded client-side |

### 8. User docs — `frontend/src/content/docs/memory.md`, `frontend/src/content/docs/security.md`

`memory.md` gains "Adding from a URL": what is accepted, the path convention and collision rule, the limits, and
that a URL is fetched once. `security.md` gains the guard's guarantees and the fencing rule.

### 9. Tests

`backend/__tests__/ops/memory-fetch.test.ts`, with a `Bun.serve` fixture and the resolver seam:

- A resolver answering one public and one private address is refused, the fixture records **no** connection,
  and the resolver is called once per hop (the pin, not a second lookup).
- A public URL that `302`s to `127.0.0.1`, `169.254.169.254`, or `[::ffff:a9fe:a9fe]` is refused at that hop; a
  sixth redirect is refused; `https` → `http` is refused; port 8080, `ftp:`, and `file:` are refused unresolved.
- A 30 MiB body and a 40 KB gzip body that inflates past the cap both stop at cap + 1; a server that stalls after
  its headers is aborted at the total timeout.
- HTML served as `application/octet-stream` converts as HTML; a PNG fails its job with phase 9's hint and stages
  nothing.
- With `fetchAllowPrivateHosts` false, loopback is refused; the suite flips it per test, never globally.

`backend/__tests__/actions/memory-add-url.test.ts` — the default path; the collision refusal naming the owner and
`replace` overriding it; reserved paths refused for admins too; one audit row per add; the version has
`sourceType = 'url'`, `operation = 'ingest'`, and `untrusted`; a failed job retries; the memory frame fires; an
outsider gets 403; `preview` writes nothing.

`backend/__tests__/bots/tools/memory-add.test.ts` — a small page returns `{ logical_path, version_id }` inline; a
large one returns a queued job; replaying the tool call id fetches once; `memory_cat` of the result is fenced; a
person's full write clears the flag and a bot's keeps it; a code-mode run that read it returns a fenced result.

`frontend/e2e/memory.spec.ts` gains: add a fixture URL, see the preview path, watch the job finish with no reload,
open the Source block. `cli/__tests__/memory.test.ts` — URL arguments go to the server; local paths still upload.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, against a page on a public host:

1. Memory → **Add from URL**, paste it, and watch the preview read `remotes/<host>/<path>`. Submit; the job
   finishes without a reload.
2. Open the file: rendered markdown, an H1 from `<title>`, and a Source block with the URL and fetch time.
3. `botholomew memory add https://<host>/report.pdf --wait`; `botholomew memory search` finds its text.
4. Ask the leader in chat to add a public URL and quote its first heading. The next `memory_cat` in the
   transcript shows the content inside an `<untrusted>` fence.

Then the edge cases:

- With `MEMORY_FETCH_ALLOW_PRIVATE_HOSTS=false`, `http://localhost:8080/` and `http://169.254.169.254/` are
  refused, the message naming the address.
- A URL that redirects to a private address fails at the hop, and the job's error says which.
- `?id=1` then `?id=2` of one page: the second is refused as owned by the first until `--replace`.
- `--path prompts/x.md` is refused for an admin; a 40 MiB file fails as too large and leaves no version.

## Definition of done

- [ ] `guardedFetch`: pinned lookup, per-hop redirect checks, scheme and port allowlist, decoded-byte cap, three timeouts
- [ ] HTML signature in `sniffMime`; `<title>` promotion; canonical recorded, not followed; unsupported types refused before queueing
- [ ] Source columns filled (`sourceType = 'url'`), `fetcherArgs`, conditional-request headers, and `untrusted` on `memory_files`
- [ ] `remotes/<host>/<path>` default, collision refusal with `replace`, reserved paths refused
- [ ] `memory:add` takes `url` and `preview` (audited, MCP); `memory:fetch` task-only on `default`
- [ ] `memory_add url` inline under 1 MiB, queued above, `replay: safe`; fencing in every bot read path and code mode
- [ ] Per-project and per-host rate limits; dialog, Source block, CLI, user docs; tests as listed

## Commands

```bash
botholomew memory add https://example.com/handbook/onboarding --wait
botholomew memory add https://example.com/q3.pdf --path finance/q3-report.md --note "board deck"
curl -s -X PUT localhost:8080/api/memory/add -H "Cookie: $C" -H 'Content-Type: application/json' \
  -d '{"projectId":1,"url":"https://example.com/handbook","preview":true}' | jq
cd backend && bun keryx.ts memory:fetch --jobId 42      # run one fetch by hand
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then the plan
above is the only account.
