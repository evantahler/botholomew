# Phase 19 — URL ingest

> **Goal:** A person or a bot hands project memory a public URL, and the page or document behind it lands as a
> markdown file at `remotes/<host>/<path>` with its provenance attached — fetched once, by the server, through a
> guard that will not reach anything but the public internet.

> **Status: planned, not built.** Stage F — Memory, later. Depends on
> [phase 4](./phase-04-project-memory-core.md) (versioned files), [phase 6](./phase-06-durable-bot-loop.md)
> (provenance fencing, `tool_calls`), [phase 9](./phase-09-memory-search-and-ingestion.md) (converters, ingest
> jobs, `memory_add`), and [phase 10](./phase-10-mcp-servers-and-approvals.md) (the ported `NetworkGuardOps`).

[Phase 9](./phase-09-memory-search-and-ingestion.md) stops at uploads for a reason: until now the server never
reaches out. Every byte in project memory arrived in a request body that a signed-in person or a bot's own write
sent. Adding from a URL is the first time the server fetches an address that somebody *typed* — and, worse, an
address a bot chose, possibly because a page it read told it to. That is server-side request forgery in its
textbook shape, with a prompt-injection delivery mechanism bolted on, so this phase is mostly about the fetch and
only a little about the feature.

membot never had this. Its [plan](https://github.com/evantahler/membot/blob/main/docs/plan.md) is explicit that
there is "no generic-web catch-all": an unclaimed URL is an error telling the user to download the file and add
it locally. That is the right answer for a local CLI and the wrong one for a cloud service whose bots have no
local disk. v1 tried the opposite — [milestone 8](https://github.com/evantahler/botholomew/blob/v1/docs/plans/milestone-8-remote-context.md)
had an LLM loop *choose* how to fetch each URL — and
[milestone 13](https://github.com/evantahler/botholomew/blob/v1/docs/plans/milestone-13-replace-context-with-membot.md)
removed it in favour of membot's deterministic downloaders. 2.0 takes the middle: one deterministic public
fetcher, plain HTTP, no browser, no model in the loop, behind a guard.

What this phase leaves out is as deliberate as what it adds. A URL is fetched **once**; keeping it current is
[phase 20](./phase-20-upstream-refresh.md). Anything that needs a credential — a private GitHub issue, a Google
Doc — goes through an MCP-backed router in [phase 21](./phase-21-source-routers-and-bulk-sync.md), never through
headers or cookies on this fetcher. Image captions and scanned-PDF conversion are
[phase 22](./phase-22-llm-assisted-ingestion.md). The fetched bytes themselves are discarded after conversion
until [phase 23](./phase-23-original-bytes-and-blob-policy.md) keeps originals.

## Scope

**In:** `MemoryFetchOps` — a guarded, pinned, redirect-checking, size- and time-capped public `GET` with
content-type sniffing; HTML → markdown through turndown with membot's cleaning; routing every other recognised
mime through phase 9's converters; the `remotes/<host>/<path>` default path and a refusal to overwrite a path
owned by a different source; source columns on `memory_files` (`sourceType = 'remote'`, `sourceUrl`,
`sourceFinalUrl`, `fetchedAt`, `sourceSha256`, `sourceMime`, `sourceEtag`, `sourceLastModified`, `fetcher`,
`fetcherArgs`) and the carried-forward `untrusted` flag; URL jobs on phase 9's ingest-job rows; `memory:add-url`
(audited, MCP); the `memory:fetch` task; `memory_add` accepting `url`; provenance fencing of fetched content in
every bot read path; the web "Add from URL" dialog; `botholomew memory add <url>`; user docs; tests against a
local fixture server.

**Out:** scheduled refresh and the `--refresh` flag ([phase 20](./phase-20-upstream-refresh.md)); authenticated
or tool-backed sources, bulk import, and sync ([phase 21](./phase-21-source-routers-and-bulk-sync.md)); image
URLs and model-assisted conversion ([phase 22](./phase-22-llm-assisted-ingestion.md)); keeping the fetched bytes
([phase 23](./phase-23-original-bytes-and-blob-policy.md)). Never: a headless browser or JavaScript rendering
(membot removed Playwright for good reason), link-following or crawling, cookies, caller-supplied headers.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| `assertPublicUrl` / `isPublicIpAddress` | The address-not-hostname rule, the full IANA special-purpose table, embedded-IPv4 unwrapping, fail-closed DNS, the cloud-metadata list. Its own JSDoc names DNS rebinding and redirects as the residuals — exactly what this phase closes | `toolexec:backend/ops/NetworkGuardOps.ts`, ported by [phase 10](./phase-10-mcp-servers-and-approvals.md) |
| The guard's suite | An exhaustive table test of the pure range check | `toolexec:backend/__tests__/ops/network-guard.test.ts` |
| Re-check on every request | `boundedFetch` re-runs the guard for each URL an *upstream* names, not only the configured one | `toolexec:backend/ops/McpProbeOps.ts` |
| Capped body reads | "Read one byte past the cap" so *at* and *over* the limit are distinguishable | `toolexec:backend/ops/RawRequestOps.ts` |
| HTML → markdown | turndown (ATX headings, fenced code, `-` bullets) after stripping `script` / `style` / `noscript` | [src/ingest/converter/html.ts](https://github.com/evantahler/membot/blob/main/src/ingest/converter/html.ts) |
| Mime dispatch | The converter table phase 9 ports | [src/ingest/converter/index.ts](https://github.com/evantahler/membot/blob/main/src/ingest/converter/index.ts) |
| Default URL path | `defaultLogicalForUrl`: `remotes/{host}/{pathname}`, query and fragment dropped, full URL kept on the row | [src/ingest/ingest.ts](https://github.com/evantahler/membot/blob/main/src/ingest/ingest.ts) |
| Replayable fetcher identity | `downloader` + `downloader_args` persisted per version so refresh replays the same fetch | [src/ingest/sources/types.ts](https://github.com/evantahler/membot/blob/main/src/ingest/sources/types.ts) |
| Versioned files, path validation, `expectedVersionId`, live frames | Where a fetched file is written | [phase 4](./phase-04-project-memory-core.md) |
| Converters, describer, ingest jobs, embedding, `memory_add` | Everything after the bytes arrive | [phase 9](./phase-09-memory-search-and-ingestion.md) |
| Provenance fencing | Untrusted content wrapped as data in tool results | [phase 6](./phase-06-durable-bot-loop.md) |

## What this must not weaken

1. **In production the server never connects to a non-public address** — judged on the address actually
   connected to, at every redirect hop, not on a hostname or on a resolution that preceded the connection.
2. **A fetch carries no authority.** No cookie, no `Authorization`, no project secret, no caller-supplied header
   ever rides on it. Anything that needs a credential is a [phase 21](./phase-21-source-routers-and-bulk-sync.md)
   router over the project's own MCP server.
3. **Fetched text is data, never instruction.** It is fenced in every bot read path, and it can never be written
   into a reserved path (`skills/`, `prompts/`, `bots/<slug>/prompts/`).
4. **No model decides how to fetch.** The fetcher is deterministic; v1's milestone 8 is the counter-example.
5. **Append-only.** A fetch is a new version authored by whoever asked; nothing is overwritten in place.
6. **Every human decision is audited**; a bot's fetch is recorded on its `tool_calls` row.
7. **Embeddings stay local** and keyless; a fetched page costs no model spend in this phase.

## Design

### The guard moves into the connection

`assertPublicUrl` resolves a name, judges every address, and then lets `fetch` resolve it again. Between the
two a one-second TTL can change the answer — DNS rebinding — and ToolExec accepted that because the input was a
gateway URL an admin typed. Here the input is any URL any member or bot supplies, so the window is closed rather
than documented:

- **One resolution, judged and used.** `guardedFetch` connects through `node:https` / `node:http` with a
  `lookup` hook that resolves, runs every returned address through `isPublicIpAddress`, refuses if *any* is
  non-public (a mixed answer is the round-robin bypass ToolExec names), and hands the socket the address it
  judged. There is no second lookup to race. If Bun's `node:https` ever ignores `lookup`, that is a Bun bug to
  report upstream with a repro, not a reason to fall back to resolve-then-fetch; the rebinding test below is the
  tripwire.
- **Redirects are followed by hand.** `redirect: "manual"`, at most `fetchMaxRedirects` (5) hops, each
  `Location` resolved against the current URL and put through the full check again — scheme, port, and pinned
  address. An `https` → `http` hop is refused: nothing secret rides on the request, but a downgrade lets an
  on-path party substitute the document.
- **Scheme and port.** `http` and `https` only; ports 80 and 443 only (`fetchAllowedPorts`). A public-only guard
  still lets a caller use the service to probe a third party's admin ports; restricting ports costs no real
  document anything.
- **Development escape hatch.** `fetchAllowPrivateHosts`, false in production and true elsewhere, with the same
  reasoning ToolExec gives for `allowPrivateHosts`: the fixture server is on loopback. It is a separate switch
  from phase 10's, because turning off the gateway guard should not silently turn off this one.

### Caps, sniffing, and what gets accepted

The body is streamed and **decoded bytes** are counted, stopping one byte past `fetchMaxBytes` (25 MB, phase
9's upload cap) — counting wire bytes would let a 50 KB gzip bomb inflate to gigabytes. Time is capped three
ways: connect (5 s), first byte (10 s), and total (30 s), all through one `AbortSignal`.

`Content-Type` is a hint, as is the URL's extension. `sniffMime` reads the first bytes: `%PDF-` is a PDF; a ZIP
whose central directory names `word/`, `xl/`, or `ppt/` is DOCX / XLSX / PPTX; `<!doctype html` or `<html` is
HTML; valid UTF-8 with no NULs is text. A recognised binary signature wins over the header (servers label PDFs
`text/html` often enough to matter); otherwise the header wins. The result must be a mime phase 9 converts.
Anything else — images, archives, video, an unknown binary — is refused with a hint rather than stored as a
placeholder, because a placeholder fetched from the web is noise that refresh would then keep current. Images
become acceptable when [phase 22](./phase-22-llm-assisted-ingestion.md) can caption them.

HTML goes through turndown with membot's script / style / noscript stripping, plus two additions membot did not
need: the document's `<title>` becomes an H1 when the body has none (so phase 9's title-derived describer has
something to work with), and `<link rel="canonical">` is recorded but **not followed** — following it would be a
second, unasked-for fetch.

The request identifies itself honestly (`User-Agent: Botholomew/<version> (+https://botholomew.com/bot)`) and
sends nothing else of note. It does not consult `robots.txt`: that file governs crawlers, and a one-shot fetch a
person or bot asked for, with no link-following, is a user agent's request. [Phase 20](./phase-20-upstream-refresh.md)
revisits that for scheduled fetches.

### Paths and collisions

The default path is membot's `remotes/<host>/<pathname>` — host lowercased by `URL`, trailing slash trimmed, an
empty path becoming `index`, query and fragment dropped — validated by phase 4's path rules like any other.
Dropping the query means `?id=1` and `?id=2` share a path, so the add **refuses to write over a current file whose
`sourceUrl` differs** (or that has no URL at all, such as a note a person wrote there), naming the owner and
hinting `--path` or `--replace`. Silently turning one source's history into another's is the failure that
refusal prevents.

A caller-supplied path may point anywhere except the reserved namespaces. Fetched text in `prompts/` would be a
web page loaded into every bot's system prompt; that is refused outright, with no override.

### Provenance, and what "untrusted" follows

Every version a fetch writes has `untrusted = true`. When a bot reads it — `memory_cat`, `memory_search`
snippets, `memory_diff`, and code mode's `memory.*` — the content arrives inside phase 6's fence with
`{ source: "fetched", url, fetchedAt }`. A code-mode run that read any untrusted file has its own result fenced,
which is cheap taint tracking at the granularity that matters.

The flag is carried forward by `edit`, `cp`, `mv`, and `restore` from an untrusted version, and by any bot
`write` over one (a bot rewriting a page it read is laundering it). A person's full `write` clears it — they are
authoring the whole content and vouching for it. The residual is stated rather than implied: a bot that reads a
fenced page and copies its words into a *different* file launders them, and fencing cannot follow that. Fencing
is a hint to the model; the controls are phase 10's approval gate and the reserved-path refusal above.

### One job, two callers

A person's add is asynchronous: `memory:add-url` inserts a phase 9 ingest job with `kind = 'url'` and returns it;
the `memory:fetch` task runs fetch → sniff → convert → describe → commit on the `default` queue (network-bound
work stays off the CPU-bound `embed` queue), then hands chunking and embedding to phase 9 exactly as an upload
does. Progress arrives on `project:<id>:memory` frames; a failure is a failed job with phase 9's retry.

A bot's `memory_add url` runs the **same job inline** and returns its outcome, because a bot needs the path and
version to continue, and a polling loop would burn steps. The job row is keyed by the bot's `toolCallId`
(unique), so a replay after a crash finds the existing job instead of fetching twice; that is what makes the tool
`replay: safe`. Rate limits — `fetchPerProjectPerMinute` (30) and `fetchPerHostConcurrency` (2) — apply to both
callers, so the service cannot be turned into a way to hammer someone else's site.

## Steps

### 1. Schema — `backend/schema/memory_files.ts`, `backend/schema/memory_ingest_jobs.ts`

Phase 4 reserved `sourceType`; this phase adds the `remote` value and these columns to `memory_files`:

| Column | Type | Notes |
|---|---|---|
| `sourceUrl` | `text` | The URL as requested; what refresh replays |
| `sourceFinalUrl` | `text` | After redirects; shown, never replayed |
| `fetchedAt` | `timestamptz` | When the bytes were read |
| `sourceSha256` | `text` | sha of the decoded fetched bytes — refresh compares against this |
| `sourceMime` | `text` | The sniffed mime that chose the converter |
| `sourceEtag`, `sourceLastModified` | `text` | Stored now so refresh can send conditional requests |
| `fetcher` | `text` | `url` here; `router` in [phase 21](./phase-21-source-routers-and-bulk-sync.md). Refresh dispatches on it |
| `fetcherArgs` | `jsonb` | Null for `url`; router name, vars, and collection later |
| `untrusted` | `boolean not null default false` | Carried forward as described above |

Index `(projectId, sourceUrl) WHERE isCurrent` for the collision check. Phase 9's ingest-job table gains
`kind = 'url'`, `sourceUrl`, `toolCallId` (nullable, unique) and `httpStatus`.

### 2. Config — `backend/config/memory.ts`

`fetchMaxBytes` (25 MB), `fetchConnectTimeoutMs` (5 000), `fetchFirstByteTimeoutMs` (10 000), `fetchTimeoutMs`
(30 000), `fetchMaxRedirects` (5), `fetchAllowedPorts` (`[80, 443]`), `fetchAllowPrivateHosts` (false in
production), `fetchUserAgent`, `fetchPerProjectPerMinute` (30), `fetchPerHostConcurrency` (2) — each from
`loadFromEnvIfSet` under `MEMORY_FETCH_*`.

### 3. Ops — `backend/ops/MemoryFetchOps.ts`

- `guardedFetch(url, { signal })` — pinned lookup, manual redirects, port and scheme checks, decoded-byte cap;
  returns `{ bytes, finalUrl, status, headers, redirects }`; throws a typed refusal naming the address.
- `sniffMime(bytes, declared, url)` — the rules above; returns a phase 9 mime or a refusal with a hint.
- `defaultRemotePath(url)` — membot's convention, run through phase 4's validator.
- `assertPathAvailable(tx, projectId, path, sourceUrl, { replace })` — the collision refusal.
- `runUrlJob(jobId)` — fetch → sniff → convert → describe → commit with `untrusted = true`, then phase 9's
  embedding hand-off; idempotent on a job already past `fetching`.
- `setResolverForTesting(fn)` — the seam that lets a test return chosen addresses; restore in `afterEach`.

### 4. Actions — `backend/actions/memory/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory:add-url` | `PUT /memory/url` | `RateLimit`, `ProjectMemberMiddleware()` + phase 4's namespace write check | Yes — the decision to ingest | Yes |
| `memory:fetch` | — (task-only, queue `default`) | — | No — machine writer; the job and version are the record | No |

`memory:add-url` takes `{ projectId, url, path?, replace?, changeNote?, preview? }`. `preview: true` runs the guard
and path resolution without fetching and returns `{ path, collision }`, which is what the dialog shows before
anyone commits to a fetch. Phase 9's `ingest-job:list` / `view` / `retry` show URL jobs without change.

### 5. Bot tools — `backend/bots/tools/memory_add.ts`

`memory_add` gains `url` (mutually exclusive with phase 9's `content`), `path`, and `replace`; its description
is regenerated with `[[ bash equivalent command: wget -O <path> <url> ]]` for the URL form. `replay: safe` by the
`toolCallId` key. Errors are PATs envelopes with a classification (`refused_address`, `too_large`,
`unsupported_type`, `timeout`, `http_status`, `path_owned`) and a next action — `unsupported_type` on a Google
Doc URL, for example, hints that a router may exist and to try `memory_sources` once
[phase 21](./phase-21-source-routers-and-bulk-sync.md) ships. `memory_cat`, `memory_search`, and `memory_diff`
wrap untrusted versions in the phase 6 fence.

### 6. Frontend — `frontend/src/pages/MemoryPage.tsx`, `frontend/src/components/memory/AddFromUrlDialog.tsx`

An "Add from URL" button beside upload. The dialog takes the URL and an optional path, calls `preview` as the
person types (debounced) to show where it will land or whom it would overwrite, and on submit shows the job in
phase 9's job list. The info panel gains a **Source** block: original URL, final URL, fetched time, mime, and an
"untrusted (fetched)" badge.

### 7. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory add <url…> [--path p] [--replace] [--note n] [--wait]` | Arguments matching `^https?://` go to `memory:add-url`; everything else stays phase 9's client-side upload. `--wait` follows the job to completion; `--json` everywhere |

### 8. User docs — `frontend/src/content/docs/memory.md`, `frontend/src/content/docs/security.md`

`memory.md` gains "Adding from a URL": what is accepted, the path convention, the collision rule, the limits, and
that the page is fetched once. `security.md` gains the guard's guarantees (public addresses only, checked on the
connected address and every redirect; no credentials sent) and the fencing rule.

### 9. Tests

`backend/__tests__/ops/memory-fetch.test.ts` — a `Bun.serve` fixture server plus the resolver seam:

- A resolver answering one public and one private address is refused, and the fixture records **no**
  connection; the resolver is called once per hop (the pin, not a second lookup).
- A public URL that `302`s to `127.0.0.1`, to `169.254.169.254`, and to `[::ffff:a9fe:a9fe]` is refused at the
  hop; six redirects are refused at the cap; `https` → `http` is refused.
- Port 8080 is refused; `ftp:` and `file:` are refused before any resolution.
- A 30 MB body stops at 25 MB + 1 and reports `too_large`; a 40 KB gzip body inflating past the cap does the same.
- A server that sends headers then stalls is aborted at the total timeout.
- A PDF served as `text/html` is converted as a PDF; a PNG is refused with the captioning hint.
- With `fetchAllowPrivateHosts` false, loopback is refused; the suite flips it per test, never globally.

`backend/__tests__/actions/memory-url.test.ts` — default path; collision refusal naming the owner and `replace`
overriding it; reserved paths refused even for admins; one audit row per add; a failed job is retryable; the
`project:<id>:memory` frame fires; an outsider gets 403; `preview` writes nothing.

`backend/__tests__/bots/tools/memory-add.test.ts` — the inline job returns `{ path, versionId }`; replaying the
same `toolCallId` fetches once; `memory_cat` of the result is fenced and a person's full write clears the flag
while a bot's `write` keeps it; a code-mode run that read it returns a fenced result.

`frontend/e2e/memory.spec.ts` — add a fixture URL, see the preview path, watch the job finish without a reload,
open the file and see the Source block. `cli/__tests__/memory.test.ts` — URL arguments route to the server,
local paths still upload.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, in the browser and a terminal:

1. Serve a fixture page from another machine or a public host. In Memory, click **Add from URL**, paste it, and
   watch the preview read `remotes/<host>/<path>`. Submit; the job moves to done without a reload.
2. Open the file: rendered markdown, an H1 from `<title>`, and a Source block with the URL and fetch time.
3. `botholomew memory add https://<host>/report.pdf --wait`, then `botholomew memory search` finds its text.
4. In chat, ask the leader to add a public URL and quote its first heading. The transcript shows `memory_add`
   with `untrusted` content arriving fenced on the next `memory_cat`.

Then the edge cases:

- With `MEMORY_FETCH_ALLOW_PRIVATE_HOSTS=false`, `http://localhost:8080/` and `http://169.254.169.254/` are
  refused, the message naming the address.
- A URL that redirects to a private address is refused at the hop, and the job's error says which hop.
- Add `?id=1` then `?id=2` of the same page: the second is refused as owned by the first until `--replace`.
- `--path prompts/x.md` is refused for an admin too.
- A 40 MB file fails `too_large`; a slow server fails `timeout`; neither leaves a version behind.

## Definition of done

- [ ] `guardedFetch` with a pinned lookup, manual redirects re-checked per hop, scheme/port allowlist, decoded-byte cap, and three timeouts
- [ ] `sniffMime` with signature-over-header precedence; unsupported types refused with hints
- [ ] HTML through turndown with membot's stripping, `<title>` as H1, canonical recorded not followed
- [ ] Source columns, `fetcher` / `fetcherArgs`, and `untrusted` on `memory_files`; URL jobs on phase 9's job rows
- [ ] `remotes/<host>/<path>` default, collision refusal with `--replace`, reserved paths refused
- [ ] `memory:add-url` audited and MCP-visible with `preview`; `memory:fetch` task-only on `default`
- [ ] `memory_add url` inline, `replay: safe` by `toolCallId`; fencing in every bot read path and code mode
- [ ] Per-project and per-host rate limits
- [ ] Add-from-URL dialog, Source block, CLI `memory add <url>`, user docs
- [ ] Tests cover rebinding, redirect hops, caps, bombs, sniffing, collisions, reserved paths, replay, and fencing

## Commands

A sketch of the operator path; none of these exist yet.

```bash
botholomew memory add https://example.com/handbook/onboarding --wait
botholomew memory add https://example.com/q3.pdf --path finance/q3-report.md --note "board deck"
botholomew memory info remotes/example.com/handbook/onboarding --json | jq '.file.source'

curl -s -X PUT localhost:8080/api/memory/url -H "Cookie: $C" -H 'Content-Type: application/json' \
  -d '{"projectId":1,"url":"https://example.com/handbook","preview":true}' | jq
cd backend && bun keryx.ts memory:fetch --jobId 42      # run one job by hand
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then the plan
above is the only account.
