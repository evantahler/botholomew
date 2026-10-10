# Phase 23 — Original bytes and blob policy

> **Goal:** Project memory keeps the original file behind every converted surrogate, within a policy the project
> controls. People download the PDF they uploaded, code mode can parse the spreadsheet itself, and when a converter
> improves an admin regenerates surrogates from the originals — without asking anyone to upload anything again.

> **Status: planned, not built.** Stage F — Memory, later. Depends on
> [phase 4](./phase-04-project-memory-core.md) (`memory_files`, the reserved `memory_blobs`),
> [phase 9](./phase-09-memory-search-and-ingestion.md) (uploads, converters, embedding),
> [phase 18](./phase-18-operations.md) (version retention and deletion semantics), and
> [phase 22](./phase-22-llm-assisted-ingestion.md) (captions and re-running enrichment).

Until now an ingest is lossy on purpose. [Phase 9](./phase-09-memory-search-and-ingestion.md) keeps the markdown
surrogate and the source's sha and throws the bytes away, which kept the first memory phases small and the
database honest about what it was for. The cost shows up in three places. A person who uploaded a contract cannot
get the contract back. A converter fix — a better table extractor, phase 22's captions — helps only files
ingested after it ships. And a bot in code mode that wants the numbers in an XLSX gets a markdown rendering of
them, not the cells.

membot always kept the bytes, content-addressed in a `blobs` table, and learned to stop keeping *all* of them: its
blob policy skips anything over 25 MB and any video or audio, still writes the blob row's sha, mime, and size so
dedupe and refresh keep working, and can strip bytes retroactively when the policy tightens. This phase brings
that model across nearly verbatim, and spends its design on the questions membot did not have — where the bytes
live in a multi-tenant service, how they are served without becoming a stored-XSS vector, and how regeneration
avoids clobbering human edits.

## Scope

**In:** `memory_blobs` defined (phase 4 reserved it) with `memory_blob_parts` for the bytes; per-project sha
dedupe; membot's `shouldPersistBlobBytes` predicate with a per-project policy under a platform ceiling, plus a
storage quota; metadata-only rows when bytes are skipped; an ingest job's staged payload becoming the blob in
the version's transaction instead of being nulled; image uploads opened, now that the original is kept; download
as an attachment, `memory:read bytes` for MCP clients, `memory.readBytes` in code mode;
converter revisions and `memory:reconvert`; the retroactive strip; orphan collection coordinated with phase 18;
storage accounting in `memory:stats`; UI, CLI, user docs, tests.

**Out:** object storage (a seam, not a driver — see Design); video and audio processing; serving originals inline
or as previews; keeping bytes for markdown-direct sources, whose bytes *are* the surrogate; bytes for anything
ingested before this phase (reconvert reports them); version retention itself ([phase 18](./phase-18-operations.md)
owns `memory:prune`).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| The policy predicate | One function used at write time *and* for retroactive strip, so the two cannot disagree; prefix-glob mimes; inclusive size cap | [src/ingest/blob-policy.ts](https://github.com/evantahler/membot/blob/main/src/ingest/blob-policy.ts) |
| Blob storage | Content-addressed upsert, "row exists but bytes null" as a distinct state, orphan GC, strip with reclaimed-bytes reporting | [src/db/blobs.ts](https://github.com/evantahler/membot/blob/main/src/db/blobs.ts) |
| Nullable bytes | Why skipped bytes keep their row: dedupe, refresh, and conversion-at-ingest still work | [src/db/migrations/004-nullable-blob-bytes.ts](https://github.com/evantahler/membot/blob/main/src/db/migrations/004-nullable-blob-bytes.ts) |
| Defaults and wording | 25 MB, `["video/*", "audio/*"]`, `read --bytes`, `prune --strip-blob-bytes` | README [Configuration](https://github.com/evantahler/membot/blob/main/README.md#configuration) |
| Read and prune | `bytes=true` base64 reads with a `bytes_skipped` flag; strip as a dry-run-first prune option | [src/operations/read.ts](https://github.com/evantahler/membot/blob/main/src/operations/read.ts), [src/operations/prune.ts](https://github.com/evantahler/membot/blob/main/src/operations/prune.ts) |
| Markdown-direct skip | A source that emits `text/markdown` stores no blob | [src/refresh/runner.ts](https://github.com/evantahler/membot/blob/main/src/refresh/runner.ts) |
| Bytes in Postgres, precedent | Checkpoints up to 32 MB stored as rows, because "nothing else in this system stores blobs" | `toolexec:backend/schema/agent_session_checkpoints.ts`, `toolexec:docs/plans/phase-31-sleep-and-wake.md` |
| Capped body reads | The one-byte-past-the-cap upload reader | `toolexec:backend/ops/RawRequestOps.ts` |
| Versions, path rules, `isCurrent` | What a blob hangs off | [phase 4](./phase-04-project-memory-core.md) |
| Converters, uploads, embedding, reindex shape | What reconvert re-runs | [phase 9](./phase-09-memory-search-and-ingestion.md) |
| Staged payloads | `memory_ingest_jobs.payload` holds the bytes until `memory:ingest` nulls it on success — "a deliberate stopgap" that defers this decision here | [phase 9](./phase-09-memory-search-and-ingestion.md) |
| `memory_settings` | The lazily created per-project row the policy lives in | [phase 4](./phase-04-project-memory-core.md) |
| `captionImage`, enrichment re-run | Captions for image files; re-running from stored originals | [phase 22](./phase-22-llm-assisted-ingestion.md) |

## What this must not weaken

1. **An ingest never fails because bytes could not be kept.** Over the cap, a skipped mime, a full quota — the
   surrogate, chunks, and version land regardless; only the bytes are absent, with a recorded reason.
2. **A version never points at half-written bytes.** Blob, parts, and version commit in one transaction.
3. **No byte crosses a project.** Dedupe is per project, and a blob is reachable only through a version of the
   same project.
4. **An original is never rendered by the browser on our origin.** Downloads are attachments with `nosniff` and a
   sandboxing CSP.
5. **Regeneration never overwrites an edit**, and writes a version only when the surrogate changed.
6. **Destruction is explicit.** Stripping bytes is admin-only, dry-run first, audited, and says it is
   irreversible; tombstoning a file keeps its bytes so undelete restores them.

## Design

### Postgres, in parts, with a seam

The master plan's default stands: bytes live in Postgres. The argument for it is the whole deployment —
api, worker, frontend, Redis, Postgres, nothing else. A blob in Postgres commits atomically with the version that
names it, is covered by the same backups and point-in-time recovery, is scoped by the same `projectId` foreign key
and removed by the same cascade when a project is deleted, and can be counted per project with one query.
ToolExec made the same call for 32 MB session checkpoints for the same reason. Object storage would add a
service, a credential, a second deletion path that can drift from the first, and an "orphaned in the bucket"
failure Postgres cannot have.

The argument against is size: a large table slows backups and restores, and one 25 MiB `bytea` value is
materialized whole by the driver. The 25 MiB per-file ceiling and a per-project quota bound the first. The second
is why bytes are stored in **1 MiB parts** (`memory_blob_parts`) rather than one column: a download streams part
by part, no query ever holds more than a part, and a 25 MiB upload is 25 inserts in the version's transaction.

`memory_blobs.storage` is `pg` today, and `BlobStoreOps` is the only code that reads or writes parts. When a
deployment's blob total or backup time crosses what Postgres should carry — tens of gigabytes, not hundreds of
megabytes — an S3-compatible driver behind that interface moves cold blobs without touching a caller. That is a
later decision with a measurable trigger, recorded here so nobody makes it early.

Bytes are not encrypted by the application. The surrogate in `memory_files.content` is the same text in
plaintext, so encrypting only its original would buy nothing; both rely on the database's encryption at rest.

### Dedupe and policy

Blobs are unique on `(projectId, sha256)`. Cross-project dedupe is refused: it would let one tenant learn,
through quota accounting or timing, that another holds a given file, and it would make one project's deletion
depend on another's references.

`shouldPersistBlobBytes(mime, size, policy)` is membot's function, ported unchanged and used both at ingest and by
the strip, which is the reason it exists. The policy is per project in `memory_settings` — `blobMaxSizeBytes`
(25 MiB), `blobSkipMimeTypes` (`video/*`, `audio/*`), and `blobQuotaBytes` (2 GiB) — and a project may lower the
size cap but not raise it past the platform ceiling `MEMORY_BLOB_MAX_BYTES`. A skipped file still gets a blob row
with sha, mime, size, and `skipReason` (`size`, `mime`, `quota`, or later `stripped`), exactly as membot's
nullable `bytes` does. When a blob row exists without bytes and a later ingest of the same sha is now allowed —
the policy was loosened, the quota freed — the bytes are filled in: **rehydration**, free on the next upload.

Reaching the quota never fails an ingest; it records `quota` and notifies admins once a day while it persists.
Where [phase 9](./phase-09-memory-search-and-ingestion.md)'s `memory:ingest` nulls a job's staged payload on
success, it now hands the payload to `putBlob` in the transaction that writes the version — the bytes are already
in Postgres, so keeping them is a move, not a second upload. Sources that emit markdown directly (routers with `docmd`, inline writes) store no blob, as in membot. Fetched
HTML *does* keep its bytes: turndown's configuration is exactly the kind of converter that improves.

### Image files, at last

[Phase 9](./phase-09-memory-search-and-ingestion.md) refused image uploads because accepting one would keep a
placeholder and discard the only copy. With originals kept that objection is gone, so `memory:upload`,
`memory:add`, and a [phase 19](./phase-19-url-ingest.md) URL accept PNG, JPEG, GIF, and WebP. The surrogate is
[phase 22](./phase-22-llm-assisted-ingestion.md)'s caption when enrichment is on and the model can see images,
otherwise membot's placeholder plus the filename — and a later `memory:enrich` captions it from the stored bytes.
An image whose bytes the policy would skip is still refused, because accepting it would be exactly the loss phase
9 refused. Audio and video stay refused: there is no converter, and the default policy skips their bytes.

### Serving originals

`memory:download` streams a version's original with its stored mime as `Content-Type`,
`Content-Disposition: attachment` with the original filename, `X-Content-Type-Options: nosniff`, and
`Content-Security-Policy: sandbox`. Inline rendering is never offered: an uploaded or fetched HTML or SVG file
served inline from the API origin would run with the session cookie in scope — stored XSS by design. It is a web
route only (a raw stream is not an MCP tool result); MCP clients get `memory:read` with `bytes: true`, base64, up
to `MEMORY_BYTES_MCP_MAX` (5 MiB), beyond which the hint points to the CLI or web download. Read access is project
membership, like every other read of memory.

Bots do not get bytes in `memory_cat` — base64 in a model's context is cost with no meaning. Code mode
([phase 11](./phase-11-code-mode.md)) gains `memory.readBytes(path, { version })`, returning a `Uint8Array` under
phase 11's per-run memory caps, which is where parsing an XLSX's cells belongs.

### Reconvert: regenerate, never clobber

Each converter declares a revision (`pdf@3`, `html@2`), and every converted version records `converterRevision`.
`memory:reconvert` (admin) selects current versions by prefix and mime whose revision is behind, dry-run by
default, and reports four counts: would change, unchanged, **no bytes** (skipped, stripped, or pre-dating this
phase — remote ones can use [phase 20](./phase-20-upstream-refresh.md)'s forced refresh instead), and **edited
since conversion** (the current version is not the machine-written one, so it is left alone). Applied, it runs as
a resumable batch on `default` / `embed` like phase 9's reindex, writes a version only when the surrogate's sha
changed — `systemActor = 'reconvert'`, note `reconvert: pdf@2 → pdf@3` — and re-chunks and re-embeds through phase
9. When [phase 22](./phase-22-llm-assisted-ingestion.md) enrichment is on, reconvert runs it and the dry run
includes its spend estimate; this is also what lets phase 22 caption uploads from their stored originals.

### Strip and collect, with phase 18

`memory:blob-strip` applies the current policy retroactively — membot's `prune --strip-blob-bytes` — deleting the
parts of every blob the predicate now rejects, keeping the row with `skipReason = 'stripped'`, and reporting the
bytes reclaimed. It is admin-only, dry-run by default, audited, and the confirmation says it cannot be undone.

Blobs follow versions, not paths. A tombstoned file keeps its blob, because undelete must restore the original.
A blob becomes collectable only when no version references it, which happens only when
[phase 18](./phase-18-operations.md)'s retention prunes old versions or deletes a project. Phase 18's
`memory:prune` already deletes a `memory_blobs` row no version references in the same batch, and parts cascade
with it; the daily `memory:blob-sweep` (`gcOrphanBlobs`) catches anything a crash left behind. Project
deletion needs nothing: the cascade from `projects` removes blobs and parts with everything else.

## Steps

### 1. Schema — `backend/schema/{memory_blobs,memory_blob_parts}.ts`

| Table | Columns | Constraints |
|---|---|---|
| `memory_blobs` | `projectId`, `sha256`, `mimeType`, `sizeBytes bigint`, `storage` (`pg`), `bytesStored boolean`, `skipReason` (nullable), `partCount`, `createdAt`, `strippedAt` | unique `(projectId, sha256)`; `projectId` cascade |
| `memory_blob_parts` | `blobId`, `partIndex`, `bytes bytea` | primary key `(blobId, partIndex)`; `blobId` cascade |

`memory_files` gains `blobId` (→ `memory_blobs.id`, `no action` — checked at statement end, so a project's
cascade removes both while deleting a blob a live version names fails) and `converterRevision`; `systemActor` and
`operation` gain `reconvert`. Phase 4's `memory_settings` gains `blobMaxSizeBytes`, `blobSkipMimeTypes text[]`, and
`blobQuotaBytes`. Index `memory_files (projectId, blobId)` for
reference checks.

### 2. Config — `backend/config/memory.ts`

`blobMaxBytes` (`MEMORY_BLOB_MAX_BYTES`, 25 MiB ceiling), `blobPartBytes` (1 MiB), `blobDefaultQuotaBytes`
(2 GiB), `bytesMcpMax` (5 MiB), `reconvertBatchSize` (50), `blobSweepFrequencyMs` (86 400 000).

### 3. Ops — `backend/ops/{MemoryBlobOps,BlobStoreOps,MemoryReconvertOps}.ts`

- `shouldPersistBlobBytes(mime, size, policy)` — membot's predicate, unchanged.
- `putBlob(tx, projectId, bytes, mime)` → `{ blobId, stored, skipReason }` — dedupe, policy, quota, rehydration.
- `BlobStoreOps.write(tx, blobId, bytes)` / `stream(blobId)` / `drop(tx, blobId)` — the only part access; `pg` now.
- `stripByPolicy(projectId, { dryRun })` → `{ blobs, reclaimedBytes }`.
- `gcOrphanBlobs(projectId?)` — delete blobs no version references; the sweep's body, and the same predicate
  phase 18's prune applies in its batch.
- `storageStats(projectId, prefix?)` — stored bytes, counts by `skipReason`, quota use.
- `CONVERTER_REVISIONS`, `reconvertCandidates(selector)`, `reconvertOne(versionId)`.

### 4. Actions — `backend/actions/memory/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory:download` | `GET /memory/file/download` | `ProjectMemberMiddleware()` | — | No — a raw stream |
| `memory:read` (phase 4) gains `bytes` | `GET /memory/file` | `ProjectMemberMiddleware()` | — | Yes, ≤ 5 MB |
| `memory:reconvert` | `POST /memory/reconvert` | `AdminMiddleware()` | Yes (when applied) | Yes |
| `memory:blob-strip` | `POST /memory/blobs/strip` | `AdminMiddleware()` | Yes (when applied) | Yes |
| `memory-settings:edit` (phase 4) gains the blob policy | `POST /memory/settings` | `AdminMiddleware()` | Yes | Yes |
| `memory:reconvert-batch` | — (task-only child) | — | No — versions are the record | No |
| `memory:blob-sweep` | — (task-only, `default`, daily) | — | No — a sweep | No |

`memory:stats` gains a `storage` block. `memory:download` sets its headers in the action, and its test asserts
them, because a framework default changing under it would be silent.

### 5. Code mode — `backend/bots/code/host-memory.ts`

`memory.readBytes(path, { version })` beside phase 11's `memory.readText` / `readJson`, under the same
`max_input_bytes`; refuses with `bytes_not_stored` and the reason.
No bot tool changes: `memory_info` reports whether an original is stored and why not.

### 6. Frontend — `frontend/src/pages/MemoryPage.tsx`, `frontend/src/components/settings/sections/MemoryStorage.tsx`

The info panel shows **Original**: filename, size, mime, and either **Download** or "not stored — larger than the
25 MiB policy" (or skipped type, quota, stripped). History rows download any version's original. Settings →
**Memory storage**: the policy form, a quota bar, storage by prefix and by reason, **Strip** (dry run, then a
confirmation naming the reclaimed size and that it is permanent), and **Reconvert** listing converters with files
behind, each with its four counts and **Run**.

### 7. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory read <path> --bytes [--version v] [-o file]` | Streams via `memory:download`; refuses to write binary to a TTY |
| `botholomew memory reconvert [prefix] [--mime m] [--apply]` | Dry run unless `--apply` |
| `botholomew memory blobs strip [--apply]` | Dry run unless `--apply` |
| `botholomew memory settings --blob-max 10MB --blob-skip 'video/*' --blob-quota 5GB` | Admin |
| `botholomew memory stats [prefix]` | Now includes storage |

### 8. User docs — `frontend/src/content/docs/memory.md`, `frontend/src/content/docs/security.md`

"Originals": what is kept, the policy and quota, downloading, reconverting, stripping, and how deleting and
retention interact with stored bytes. `security.md` notes that originals are always served as downloads.

### 9. Tests — `backend/__tests__/actions/memory-blobs.test.ts`, `backend/__tests__/ops/memory-blob-policy.test.ts`

- The predicate table: `video/*` prefix match, a bare `*`, exact matches, and the inclusive size boundary.
- An upload stores bytes in parts whose concatenation matches the sha; the same file twice is one blob; the same
  file in two projects is two blobs.
- Over the cap, a skipped mime, and a full quota each ingest successfully with a metadata-only row and the right
  reason; the quota notifies admins once a day; rehydration fills bytes after the policy is loosened.
- A failure between parts and version insert leaves neither (one transaction).
- `memory:download` returns `attachment`, `nosniff`, and `sandbox` for an uploaded HTML file; a non-member gets
  403; `memory:read bytes` over 5 MB answers with the hint; it is the MCP path, `download` is not an MCP tool.
- Reconvert after a revision bump: the dry run's four counts are right; applying writes versions only where the
  surrogate changed, with `systemActor = 'reconvert'`; an edited file is untouched.
- Strip: the dry run changes nothing; applying deletes parts, keeps rows, reports reclaimed bytes, and is audited.
- A tombstoned file keeps its blob and undelete serves it; after phase 18's prune removes the last referencing
  version, the sweep deletes the blob; deleting a project removes its parts.
- A PNG upload is accepted with its bytes and a placeholder surrogate, captioned when enrichment is on, and refused
  when the policy would skip its bytes.
- `memory:stats` storage totals equal the sum of stored part sizes.

`frontend/e2e/memory.spec.ts` gains: upload a PDF, download it, compare bytes. `cli/__tests__/memory.test.ts` gains
`read --bytes -o`.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually:

1. Upload a PDF and an XLSX. The info panel shows both originals as stored; **Download** returns identical bytes
   (`shasum` matches).
2. In code mode, ask a bot to sum a column with `memory.readBytes` and an XLSX parser; it reads the cells, not the
   markdown table.
3. Set the cap to 1 MB and upload a 3 MB PDF: it is searchable, and its panel says the original was not stored.
   `botholomew memory blobs strip` reports what a strip would reclaim; `--apply` reclaims it.
4. Bump the PDF converter's revision in a dev build; Settings → Memory storage → Reconvert lists the PDFs behind,
   with an edited one counted separately. Run it; history shows `reconvert:` versions only where text changed.

Then the edge cases:

- Upload an HTML file and open its download URL directly: the browser saves it rather than rendering it.
- Delete a file, undelete it, and download its original.
- Fill the quota: the next upload succeeds without its original, and admins get one notification.

## Definition of done

- [ ] `memory_blobs` and `memory_blob_parts` with per-project dedupe; bytes committed with the version
- [ ] membot's predicate ported unchanged; per-project policy under a platform ceiling; quota; metadata-only rows; rehydration
- [ ] `memory:download` as a sandboxed attachment; `memory:read bytes` for MCP; `memory.readBytes` in code mode
- [ ] Image uploads accepted when their bytes are kept, captioned through phase 22 when enabled
- [ ] Converter revisions and `memory:reconvert`: dry run, change-only versions, edits spared, no-bytes reported
- [ ] `memory:blob-strip` admin-only, dry run, audited; orphans collected by phase 18's prune and a daily sweep
- [ ] Storage accounting in `memory:stats`; UI, CLI, user docs, tests as listed

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then the plan
above is the only account.
