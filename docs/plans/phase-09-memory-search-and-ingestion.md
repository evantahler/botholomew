# Phase 9 — Memory search and ingestion

> **Goal:** People drop PDFs, Word documents, spreadsheets, slide decks, HTML, and text files into project
> memory from the browser or the CLI, and find anything in memory by meaning as well as by keyword. Bots search
> the same way, and can add documents they are handed.

> **Status: planned, not built.** Stage C — Shared capabilities. Depends on
> [phase 2](./phase-02-deployment.md), [phase 4](./phase-04-project-memory-core.md), and
> [phase 6](./phase-06-durable-bot-loop.md).

[Phase 4](./phase-04-project-memory-core.md)'s keyword search finds files whose words you remember. Knowledge
work asks questions in words the document never used, about documents that arrived as PDFs. This phase ports
the rest of membot's retrieval stack onto Postgres — the markdown-aware chunker, search text, local
`bge-small-en-v1.5` embeddings, and hybrid reciprocal-rank fusion over pgvector and `tsvector` — plus the
ingestion pipeline that turns office formats into the markdown surrogates everything else reads.

Embeddings are local by decision: a WASM model in the worker, so they need no key and cost no platform API
spend. That puts real CPU work inside the same processes that run bot loops, and most of this doc is about
keeping that work from hurting them — its own thread, its own queue, bounded jobs, and a reconciler instead of
trust in the queue.

Ingestion here is **deterministic**: no LLM touches a document, only the markdown surrogate and its sha are
kept, and nothing is fetched from the network. URL ingest is [phase 19](./phase-19-url-ingest.md), refresh
[phase 20](./phase-20-upstream-refresh.md), source routers and bulk sync
[phase 21](./phase-21-source-routers-and-bulk-sync.md), captions and LLM conversion
[phase 22](./phase-22-llm-assisted-ingestion.md), original bytes and the blob policy
[phase 23](./phase-23-original-bytes-and-blob-policy.md). The complete membot ledger — what is brought,
adapted, dropped, and where — is the [feature map in phase 4](./phase-04-project-memory-core.md#membot-feature-map).

## Scope

**In:** `memory_chunks` (`vector(384)` with a partial HNSW index on current chunks, `tsvector` with GIN,
`chunkIndex`, heading `context`, `searchText`, its sha, `embeddingRevision`); ports of membot's chunker and
`buildSearchText`; chunking inside every text write's transaction; the embedder (transformers +
onnxruntime-web WASM with membot's patch) on a dedicated thread, `memory:embed` jobs on the `embed` queue
and a backlog reconciler; query embedding with a cache; embedding revision, staleness, and `memory:reindex`;
hybrid search (semantic, keyword, RRF, `max_per_file` diversify with backfill, snippets, `mode`,
`pathPrefix`, `includeHistory`) behind phase 4's unchanged contract; deterministic converters for text,
markdown, structured text, HTML, PDF, DOCX, XLSX, and PPTX in an isolated converter thread; the deterministic
describer; `memory:upload` (raw bytes) and `memory:add` (JSON); `memory_ingest_jobs` with status, retry, and
a reconciler; `memory:stats`; bot tools `memory_search` (rebuilt over hybrid) and `memory_add`; the search
half of the memory prompt section; upload, search, and job UI; `botholomew memory add/search/jobs/stats/
reindex`; a deterministic fake embedder; the search-quality eval with a CI gate; docs; tests.

**Out:** fetching URLs ([phase 19](./phase-19-url-ingest.md)); `refresh_frequency` and the refresh clock
([phase 20](./phase-20-upstream-refresh.md)); MCP-backed routers, bulk import, `--sync`
([phase 21](./phase-21-source-routers-and-bulk-sync.md)); image captions, the LLM conversion fallback, and the
LLM describer ([phase 22](./phase-22-llm-assisted-ingestion.md)); original bytes, `read --bytes`,
re-conversion from source, and the blob policy ([phase 23](./phase-23-original-bytes-and-blob-policy.md));
pruning versions, chunks, and job payloads ([phase 18](./phase-18-operations.md)); cross-encoder rerank
(later, unphased). Image, audio, and video uploads are refused until captions and original bytes exist.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| Chunker | `chunkDeterministic` / `chunkMarkdown`: fence-safe ATX headings, heading breadcrumbs, paragraph → line → hard splits, two-line overlap, 1,400-character target and 1,800 maximum sized to bge-small's 512-token window | [src/ingest/chunker.ts](https://github.com/evantahler/membot/blob/main/src/ingest/chunker.ts) |
| `buildSearchText` | `path \n description (≤ 240 chars) \n breadcrumb \n\n body` — the exact string embedded and keyword-indexed | [src/ingest/search-text.ts](https://github.com/evantahler/membot/blob/main/src/ingest/search-text.ts) |
| Embedder | CLS pooling for BGE, the query instruction prefix, batches of 16 (the WASM heap OOMs beyond), the dimension check | [src/ingest/embedder.ts](https://github.com/evantahler/membot/blob/main/src/ingest/embedder.ts) |
| transformers patch | Forces onnxruntime-web WASM and removes the static `onnxruntime-node` import, applied idempotently | [patches/](https://github.com/evantahler/membot/tree/main/patches), [scripts/apply-patches.sh](https://github.com/evantahler/membot/blob/main/scripts/apply-patches.sh) |
| Embedding revision | `EMBEDDING_REVISION` and its history comment; revision 2 is the scheme ported | [src/constants.ts](https://github.com/evantahler/membot/blob/main/src/constants.ts) |
| Hybrid search | `fuseRRF` (k = 60, weighted, normalized by `1/(k+1)`), `makeSnippet`, `diversify`, `extractSnippetTerms`; candidate depth and the query/pattern fallbacks | [src/search/hybrid.ts](https://github.com/evantahler/membot/blob/main/src/search/hybrid.ts), [src/operations/search.ts](https://github.com/evantahler/membot/blob/main/src/operations/search.ts) |
| Semantic and keyword retrievers | The two lists to port (DuckDB cosine, DuckDB FTS BM25) | [src/search/semantic.ts](https://github.com/evantahler/membot/blob/main/src/search/semantic.ts), [src/search/keyword.ts](https://github.com/evantahler/membot/blob/main/src/search/keyword.ts) |
| Converters | Mime dispatch; unpdf, mammoth + turndown, SheetJS, jszip + fast-xml-parser; the scanned-PDF and unknown-binary placeholders | [src/ingest/converter/](https://github.com/evantahler/membot/tree/main/src/ingest/converter) |
| Describer | `tryTitleDescription` (H1) and `deterministicDescription` — the no-key path | [src/ingest/describer.ts](https://github.com/evantahler/membot/blob/main/src/ingest/describer.ts) |
| `stats` | The aggregate shape: counts by source and mime, sizes, health | [src/operations/stats.ts](https://github.com/evantahler/membot/blob/main/src/operations/stats.ts) |
| Search eval | Golden queries over a fixed corpus, Recall@1/@3 and MRR, a `--ci` gate (0.90 / 0.95 / 0.93) | [scripts/eval-search.ts](https://github.com/evantahler/membot/blob/main/scripts/eval-search.ts), [test/fixtures/eval/](https://github.com/evantahler/membot/tree/main/test/fixtures/eval) |
| Test fixtures and suites | `sample.pdf`, `sample-with-image.docx`; chunker, search-text, describer, converter, and hybrid tests to port | [test/fixtures/](https://github.com/evantahler/membot/tree/main/test/fixtures), [test/ingest/](https://github.com/evantahler/membot/tree/main/test/ingest), [test/search/](https://github.com/evantahler/membot/tree/main/test/search) |
| `SERVER_INSTRUCTIONS` | The search-first half of the memory prompt section | [src/mcp/instructions.ts](https://github.com/evantahler/membot/blob/main/src/mcp/instructions.ts) |
| Project memory | `MemoryOps` (the one write funnel), the final search contract, namespaces, live frames, the memory tools | [phase 4](./phase-04-project-memory-core.md) |
| Raw-body actions | `web.rawBody` hands an action the untouched stream; the action owns the size limit past `Content-Length` | [Keryx](https://keryxjs.com/) |
| Native-addon guard | The install compiles no native addon | `toolexec:backend/__tests__/deps/native-addons.test.ts` |

## What this must not weaken

1. **The project is the boundary** — in the vector index too. Every retriever filters on `projectId`, and a
   test with other tenants' near-duplicate content proves nothing leaks or crowds out results.
2. **No platform model spend.** Embeddings and conversion are local; nothing in this phase calls a model API.
3. **The server never reads a host path.** Bytes arrive in a request body; no action takes a filesystem path.
4. **Bot loops come first.** Inference and parsing never run on a worker's event loop, and memory work is on
   the `embed` queue, after `bots` and `orchestrator`.
5. **The row is the delivery; the queue is an accelerant.** Every enqueue has a Postgres-backed reconciler —
   Keryx's one-off jobs are neither retried nor deduplicated.
6. **History stays append-only.** Chunks are derived data and may be rebuilt; versions are never rewritten.
7. **Every write goes through `MemoryOps`**, so reserved-path validation, attribution, audit, and frames hold
   for uploads exactly as for edits.
8. **Search degrades, it does not fail.** No embedder means keyword results flagged as partial, not a 500.

## Design

### Chunks are derived from every text version, inside the write

`MemoryOps.writeFile` gains one step: after inserting a new head it chunks the content (pure TypeScript,
milliseconds), builds each chunk's `searchText`, and inserts `memory_chunks` rows with `embedding = NULL` —
in the same transaction. Keyword search over the new content therefore works the moment the write commits;
semantic search catches up when the vectors land. The previous head's chunks are flipped `isCurrent = false`
in the same statement batch; a tombstone flips them and adds none.

Before inserting, each new chunk looks up a chunk of the parent version with the same `searchTextSha256` and
the current revision, and copies its vector. An edit to one paragraph of a long note re-embeds only the chunks
that changed. A **move** changes the path, which is the first line of every `searchText`, so every chunk
re-embeds: membot's `mv` re-keyed rows but copied vectors computed for the old path, and that bug is closed by
construction rather than by a special case. A description is derived when the author gave none —
`tryTitleDescription`, else `deterministicDescription` — and stored on the version, because it is part of what
gets embedded.

### Embeddings run on their own thread, on the `embed` queue

`backend/embedding/` wraps one `Embedder` per process, backed by a single Bun `Worker` thread that owns the
transformers pipeline: `bge-small-en-v1.5`, CLS pooling, normalized, batches of 16, `numThreads = 1`.
Membot's own comment is the reason for the thread: ONNX WASM holds the JavaScript thread for hundreds of
milliseconds per batch. On the main thread that would stall [phase 6](./phase-06-durable-bot-loop.md)'s
lease renewals and token streaming, and trip Keryx's `maxEventLoopDelay` — the invariant
[phase 2](./phase-02-deployment.md) reserved memory for. Phase 2 assumed a child process; a thread meets the
same invariant without membot's subprocess pool — no stdio protocol, no second runtime, no model copy per
CPU — and the thread is restarted, not the process, if inference throws.

The WASM backend is used everywhere, with membot's patch applied through `patchedDependencies` (Botholomew's
backend is not a published package, so membot's reason for an imperative script does not apply). A Docker
image could load `onnxruntime-node`, but one backend means identical vectors on a macOS laptop, in CI, and in
production, and an image that ships no native inference binary. The weights are fetched at image build time
(`backend/scripts/fetch-embedding-model.ts`) and `allowRemoteModels` is off in production, so a deploy never
downloads from HuggingFace at runtime — the rate limit membot's CI tripped over. CI caches them the same way.

The worker process embeds passages; the API process embeds only queries, lazily, with a 1,000-entry LRU per
process keyed by revision and normalized query. Each process that loads the model holds on the order of
130 MB of weights plus the WASM heap; this phase measures resident memory on staging and adjusts
[phase 2](./phase-02-deployment.md)'s instance plans in the same change. If the API cannot load the model,
`memory:search` answers keyword-only with `semanticCoverage: "unavailable"`.

### The row is the delivery: embed jobs and their reconciler

Every chunk insert enqueues `memory:embed { versionId }` after commit. The job claims that version's
unembedded current chunks with `FOR UPDATE SKIP LOCKED`, at most 256 at a time, embeds them, writes vectors
and `embeddingRevision`, and re-enqueues itself if more remain — so no single job runs long enough to pin a
task processor. A version superseded before its job runs is skipped. Duplicates are harmless; the claim makes
the job idempotent.

Because a one-off enqueue may simply be lost, `memory:embed-backlog` (every 60 s, `embed` queue) finds
versions with unembedded or stale current chunks and enqueues them round-robin across projects, so one
project's ten-thousand-file import cannot starve everyone else's single note.

### One embedding scheme, revisioned

Revision numbering continues membot's: 2.0 starts at **revision 2** (CLS pooling, 1,400 / 1,800-character
chunks, breadcrumbs, a 240-character description cap), so the history comment carries over verbatim. Each
chunk records the revision it was embedded under. A bump makes older vectors stale: search reports
`semanticCoverage: "partial"`, the backlog clock re-embeds them in the background, and an admin can force it
with `memory:reindex { scope: "embeddings" }`. `scope: "chunks"` re-chunks current versions with the current
chunker and description, then re-embeds — chunk rows are derived data, so replacing them rewrites no history.
Reindex runs as `memory:reindex-run` with a cursor, re-enqueueing itself; progress lives in
`memory_settings.reindexState` and shows in stats.

### Hybrid search, ported

`memory:search` keeps phase 4's contract and widens it: `query` (natural language, embedded with the BGE
query prefix), `pattern` (keyword terms), `mode` (`hybrid` default, `semantic`, `keyword`), `pathPrefix`,
`includeHistory`, `limit` (default 10, at most 50). As in membot, a missing `pattern` falls back to `query`
and vice versa. Each retriever takes `limit × 5` candidates; `fuseRRF` (k = 60, `semanticWeight` from
`memory_settings`, default 0.6) fuses to a depth of `min(50, max(3 × limit, 20))`; `diversify` keeps at most
`maxPerFile` (default 3) hits per path and backfills; `makeSnippet` centers on the first query term. Hits join
back to `memory_files` for `versionId`; reserved paths stay excluded unless the prefix names them. Two
departures from membot: `includeHistory` applies to the keyword list too (membot's FTS only indexed current
rows), and the response reports `semanticCoverage` (`complete | partial | unavailable`) so a caller knows
when recent writes are not yet in the semantic list.

Semantic is `ORDER BY embedding <=> $q` over a partial HNSW index (`WHERE isCurrent AND embedding IS NOT
NULL`); history searches fall back to an exact scan over the project's rows, which is rare and bounded.
Keyword is `websearch_to_tsquery('english', $pattern)` ranked by `ts_rank_cd(searchTsv, q, 32)` over a GIN
index on current chunks. Phase 4's file-level `searchTsv` stays as the keyword fallback for any current
version with no chunk rows — the window while the one-time backfill (`memory:reindex` over every project at
deploy) runs.

### `ts_rank_cd` is not BM25

Membot's keyword list was DuckDB's BM25: term frequency with saturation, inverse document frequency, and
length normalization. Postgres's `ts_rank_cd` is cover density — how many query terms appear and how close
together — with no IDF and only crude length normalization. A rare identifier and the word "project" count
alike. It is acceptable here for three reasons. RRF consumes **ranks**, not scores, so only the order within
the keyword list matters, never its scale. Chunks are bounded at 1,800 characters, which removes most of what
length normalization exists for. And the semantic list carries the queries where rarity matters most. That is
an argument, not a measurement, so the eval gate decides: if keyword-heavy golden queries regress beyond the
thresholds, a BM25 extension is evaluated before this phase ships, and the learnings record which way it went.

### Multi-tenant vector search

One HNSW index serves every project, and a filtered approximate search can return too few rows when the
caller's project is small next to the table. The search transaction sets `hnsw.iterative_scan =
relaxed_order` and `hnsw.ef_search = 100` (pgvector 0.8), re-sorts candidates by distance in TypeScript
(fusion only needs ranks), and the eval harness gains a **multitenant** variant: the golden corpus in one
project beside about 50,000 noise chunks in others, required to land within two points of the single-tenant
recall. If it does not, small projects switch to an exact scan over their own rows, chosen by chunk count;
the threshold is measured here, not guessed.

### Converters are deterministic and sandboxed

Each conversion runs in a fresh converter `Worker` thread with a 120 s deadline; on timeout the thread is
terminated and the job fails as retryable. Parsing untrusted office files is where hangs and memory bombs
live, so the main loop never does it. The type is sniffed from magic bytes (`%PDF-`; a ZIP's
`[Content_Types].xml` to tell DOCX, XLSX, and PPTX apart), and a mismatching `Content-Type` loses. ZIP-based
formats are refused before inflating if the central directory declares more than 200 MiB or 10,000 entries.

| Input | Surrogate |
|---|---|
| Markdown, plain text | As-is; invalid UTF-8 is refused with a hint |
| JSON, YAML, XML, CSV, JS, TS | A fenced code block with a language tag — membot's no-key path returned raw text, and a `# comment` in YAML would otherwise become a markdown heading the chunker splits on |
| HTML / XHTML | turndown; inline images become membot's deterministic placeholder |
| DOCX | mammoth → turndown; images as placeholders |
| XLSX | One table per sheet. Membot pins npm `xlsx` 0.18.5, which carries published advisories fixed only in releases SheetJS distributes outside npm; 2.0 pins a current release from SheetJS's own tarball, by version and integrity |
| PPTX | One section per slide: titles, text, notes |
| PDF | unpdf text; a scanned PDF becomes membot's "(scanned PDF, N bytes — no recognizable text)" |
| Images, audio, video, unknown binaries | **Refused** (415) with the list of supported types |

Refusing images is deliberate: without captions ([phase 22](./phase-22-llm-assisted-ingestion.md)) or the
original bytes ([phase 23](./phase-23-original-bytes-and-blob-policy.md)), accepting one would store a
placeholder and discard the only copy — data loss presented as success. Surrogates may be up to 10 MiB, above
phase 4's 5 MiB interactive write cap.

### Uploads: bytes in, surrogate out, nothing read from the host

Membot's `add` resolved local paths, directories, and globs **on the machine running membot** — and its MCP
server exposed that to any connected model. Here the CLI walks the user's own disk and uploads bytes; the
server has no notion of a host path. `memory:upload` is a `web.rawBody` action: query parameters carry
`logicalPath`, the original filename, an optional description, change note, `expectedVersionId`, and a
`requestId`; the body is counted as it streams and aborted past `MEMORY_UPLOAD_MAX_BYTES` (25 MiB), because a
raw-body action owns its limit past `Content-Length` (`WEB_MAX_BODY_SIZE` is raised above it). Permission on
the target path is checked before the body is read. The bytes go into a `memory_ingest_jobs` row and the
action returns the job. Over MCP there is no raw request, so `memory:upload` is HTTP-only; `memory:add` takes
JSON (`content`, or `contentBase64` up to 5 MiB decoded, plus `mimeType`) and is the MCP-published way in.

### Ingest jobs

`memory:ingest { jobId }` (`embed` queue) claims the job, hashes the payload into `sourceSha256`, and if the
path's live head came from the same source bytes, finishes as `unchanged`. Otherwise it converts, describes,
and writes through `MemoryOps` as the uploader (`operation: ingest`, `sourceType: upload`, and phase 4's reserved
`sourceSha256`, `sourceMime`, and `sourceFilename`), which chunks and enqueues embedding in that transaction. The payload is
nulled on success. `memory:ingest-sweep` (every 60 s) re-enqueues `queued` jobs older than two minutes,
reclaims `running` jobs whose claim is older than ten minutes (attempts capped at three), and nulls failed
jobs' payloads after seven days. `(projectId, requestId)` is unique, so a CLI retry or a replayed bot tool call
finds its earlier job instead of ingesting twice. Staging bytes in Postgres is a deliberate stopgap: it adds no
infrastructure, and [phase 23](./phase-23-original-bytes-and-blob-policy.md) decides where original bytes
live for good.

### Bot tools and the memory section

`memory_search` is rebuilt over hybrid search, keeping its name and the `[[ bash equivalent command: grep -r ]]`
tag; its description says it searches by meaning and keyword, and its envelope's `next_action_hint` points at
`memory_cat`. `memory_add` has no bash tag — converting a document into a searchable file has no honest
shell analogue, and a wrong anchor is worse than none. It takes `content` (text with a `mime_type`, converted
in the call when under 1 MiB) or `content_base64` (queued as an ingest job; `memory_info` shows the pending
job on that path). Its `requestId` is the tool call's id, so it is **replay-safe**. In this phase a bot's
binary content comes from text it holds; MCP resources ([phase 10](./phase-10-mcp-servers-and-approvals.md))
and code mode ([phase 11](./phase-11-code-mode.md)) are where base64 documents come from later. The memory
prompt section gains the search half of `SERVER_INSTRUCTIONS` — search before you read, read before you
write — minus the GitHub, Linear, and Apple Notes paragraphs, with tool names generated from the registry.

## Decisions so far

| Question | Decision |
|---|---|
| When chunks are built | Synchronously, in the writing transaction; only embedding is asynchronous |
| Re-embedding cost of edits | Vectors are reused for chunks whose `searchText` sha is unchanged |
| Where queries are embedded | In whichever process serves the search (API for people, worker for bots), lazily, cached |
| Embedder isolation | One Bun `Worker` thread per process; WASM everywhere; weights baked into the image |
| Embedding history | Only current versions are embedded; superseded versions keep vectors they already had |
| Keyword ranking | `ts_rank_cd` under RRF, kept or replaced by what the eval measures |
| Images and binaries | Refused until captions and original bytes exist |
| XLSX dependency | Not npm `xlsx` 0.18.5; a current SheetJS release pinned from its own tarball |
| Upload transport | Raw-body HTTP for files (never MCP); JSON `memory:add` for MCP and bots |

## Steps

### 1. Schema — `backend/schema/{memory_chunks,memory_ingest_jobs}.ts`

`CREATE EXTENSION IF NOT EXISTS vector` in the migration. `memory_chunks`:

| Column | Type | Notes |
|---|---|---|
| `projectId` | `integer` | cascade |
| `versionId` | `integer` | → `memory_files.id`, cascade |
| `logicalPath` | `text COLLATE "C"` | Denormalized for prefix filters |
| `isCurrent` | `boolean` | Flipped when the file's head moves |
| `chunkIndex` | `integer` | `uniqueIndex(versionId, chunkIndex)` |
| `chunkContent`, `context`, `searchText` | `text` | Body, breadcrumb, the embedded string |
| `searchTextSha256` | `varchar(64)` | Vector reuse key |
| `searchTsv` | `tsvector` | Generated from `searchText` |
| `embedding` | `vector(384)` | Null until embedded |
| `embeddingRevision`, `embeddedAt` | `smallint`, `timestamp(withTimezone)` | |

Indexes: HNSW `(embedding vector_cosine_ops) WHERE isCurrent AND embedding IS NOT NULL`; GIN on `searchTsv
WHERE isCurrent`; `(projectId, logicalPath) WHERE isCurrent`; `(projectId) WHERE isCurrent AND (embedding IS
NULL OR embeddingRevision < current)` for the backlog. `memory_ingest_jobs`: `projectId`, `logicalPath`,
`status` (`queued | running | succeeded | unchanged | failed`), `payload bytea`, `payloadSizeBytes`,
`kind` (`upload | add`; [phase 19](./phase-19-url-ingest.md) adds `url`), `sourceFilename`, `sourceMime`,
`sourceSha256`, `description`, `changeNote`, `expectedVersionId`,
`requestId` (`uniqueIndex(projectId, requestId)`), `createdByUserId`, `createdByBotId`, `onBehalfOfUserId`,
`versionId`, `attempts`, `lastError` (≤ 2 KB, scrubbed), `claimedAt`, `finishedAt`, `createdAt`; indexes
`(projectId, createdAt DESC)` and `(status, createdAt)`. New `memory_settings` (one row per project, created
lazily by `getOrCreateMemorySettings` after ToolExec's `getOrCreateSettings`): `semanticWeight` (0.6),
`maxPerFile` (3), `reindexState jsonb`; `memory_files` gains `descriptionDerived boolean`.

### 2. Config — `backend/config/memory.ts`

`uploadMaxBytes` (25 MiB), `addMaxBytes` (5 MiB), `surrogateMaxBytes` (10 MiB), `convertTimeoutMs`
(120,000), `zipMaxInflatedBytes` (200 MiB), `embedBatchSize` (16), `embedJobMaxChunks` (256),
`queryCacheEntries` (1,000), `embedder` (`real | fake`, `fake` in tests), `allowRemoteModels` (false in
production).

### 3. Ops — `backend/ops/{MemoryChunkOps,MemorySearchOps,MemoryIngestOps}.ts`, `backend/embedding/*`, `backend/memory/convert/*`

- `MemoryChunkOps`: `chunkVersion(tx, version)` (port of `chunkDeterministic` + `buildSearchText`, vector
  reuse), `retireChunks(tx, versionId)`, `claimUnembedded`, `writeEmbeddings`.
- `backend/embedding/embedder.ts`: `embedPassages(texts)`, `embedQuery(text)` (prefix + LRU), backed by
  `embedWorker.ts`; `fakeEmbedder.ts` hashes lowercase unigrams and bigrams into 384 dimensions,
  L2-normalized — deterministic, and lexical overlap still yields similarity.
- `MemorySearchOps`: `searchSemantic`, `searchKeyword` (now per chunk), `searchHybrid` (ports of `fuseRRF`,
  `diversify`, `makeSnippet`, `extractSnippetTerms`), `semanticCoverage`.
- `backend/memory/convert/`: `sniffMime`, `convert(bytes, mime)` dispatching to ported converters inside the
  converter thread, `describeDeterministic`.
- `MemoryIngestOps`: `createJob`, `runJob`, `serializeJob`, `memoryStats(projectId, prefix?)`.

### 4. Actions — `backend/actions/memory/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory:upload` | `PUT /memory/upload` (`rawBody`) | member + `canWritePath` | yes | **never** (an HTTP byte endpoint) |
| `memory:add` | `PUT /memory/add` | member + `canWritePath` | yes | yes |
| `memory:jobs` / `memory:job` | `GET /memory/jobs` / `GET /memory/job` | member | — | yes |
| `memory:job-retry` | `POST /memory/job/retry` | member + `canWritePath` | yes | yes |
| `memory:search` | `GET /memory/search` (widened) | member | — | yes |
| `memory:stats` | `GET /memory/stats` | member | — | yes |
| `memory:reindex` | `POST /memory/reindex` | `AdminMiddleware()` | yes (spends shared worker time) | yes |
| `memory-settings:view` / `:edit` | `GET` / `POST /memory/settings` | member / `AdminMiddleware()` | edit only | yes |

`memory:upload` joins the closed never-MCP list with that reason.

### 5. Clocks and tasks — `backend/actions/memory/*.ts`

All on the `embed` queue, `mcp = { tool: false }`: `memory:ingest` and `memory:embed` and
`memory:reindex-run` (task-only, enqueued); `memory:embed-backlog` and `memory:ingest-sweep` (`frequency`
60 s).

### 6. Bot tools — `backend/bots/tools/memory/{search,add}.ts`

| Tool | Tag | Replay | Inputs |
|---|---|---|---|
| `memory_search` | `grep -r` | safe | `query?`, `pattern?`, `mode?`, `path_prefix?`, `include_history?`, `limit?` |
| `memory_add` | none (argued above) | safe (`requestId` = tool call id) | `logical_path`, `content` + `mime_type` or `content_base64` + `mime_type`, `description?`, `change_note?`, `expected_version_id?` |

`backend/bots/prompt/memorySection.ts` gains the search half.

### 7. Frontend — `frontend/src/pages/MemoryPage.tsx`, `frontend/src/components/memory/*`

Drop files or folders onto a tree directory, or use Upload; `UploadQueue` lists each file's job, live from
`project:<id>:memory` frames (`op: "ingest"`, job id, status — no content), with the error and Retry on
failure. `MemorySearchBar` gains the mode switch and a "recent changes not yet in semantic search" note when
coverage is partial. `MemoryInfoPanel` shows the original filename, source mime and sha, chunk count, and
embedding state. A new Settings → Memory section (`MemorySection.tsx`) shows stats, the semantic weight and per-file cap, and admin Reindex with
progress.

### 8. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory add <files/dirs/globs…> [--prefix p] [--include g] [--exclude g] [--dry-run] [--wait]` | Walks client-side; skips dotfiles, `.git`, `node_modules`, and symlinks; maps each file to `<prefix>/<path relative to the argument>`; `requestId` = hash of path and sha, so a re-run is idempotent; URLs are refused with a hint; `--wait` follows jobs to completion |
| `botholomew memory search <query> [--pattern p] [--mode hybrid\|semantic\|keyword] [--prefix p] [--history] [--limit n]` | |
| `botholomew memory jobs [--status s]` / `job <id>` / `job retry <id>` | |
| `botholomew memory stats [prefix]` | |
| `botholomew memory reindex [--chunks] [--prefix p]` | Admin |

### 9. User docs — `frontend/src/content/docs/memory.md`

Add uploads (supported types, limits, what is refused and why), search modes and syntax, semantic coverage,
"embeddings run locally; nothing leaves the service", and reindex. Update `cli.md`, `mcp.md` (`memory:add`
over MCP; uploads are HTTP-only), and `security.md` (no host paths; isolated parsing).

### 10. Tests — `backend/__tests__/…`

- `ops/memory-chunker.test.ts` — membot's chunker and search-text cases, ported unchanged.
- `ops/memory-converters.test.ts` — membot's `sample.pdf` and `sample-with-image.docx` (the image becomes a
  placeholder); generated HTML, XLSX, PPTX; scanned-PDF placeholder; structured text fenced; **a lying
  `Content-Type` loses to the sniffed type**; invalid UTF-8 refused; a ZIP bomb refused before inflating; a
  hanging converter terminated at the deadline and the job left retryable.
- `actions/memory-upload.test.ts` — upload → job → version with `sourceType: upload`, sha, and mime;
  identical bytes → `unchanged`; a repeated `requestId` returns the first job; over the cap → 413 and no row;
  an image → 415; a reserved-path validation failure fails the job with the validator's message; the
  outsider gets 403; a non-writer is refused on `bots/x/` before the body is read; `memory:upload` is not an
  MCP tool and `memory:add` is.
- `tasks/memory-ingest.test.ts` — a lost enqueue is recovered by the sweep; a stale claim is reclaimed; the
  attempts cap ends in `failed`; retry re-runs; the payload is nulled on success.
- `actions/memory-search-hybrid.test.ts` (fake embedder) — **a write is keyword-searchable before any embed
  job runs**, with coverage `partial`, then `complete` after `drainTasks`; a chunk on both lists ranks first;
  `maxPerFile` diversifies and backfills; snippets center on the term; reserved exclusion holds;
  `includeHistory` covers both lists; **a move re-embeds** with the new path in `searchText`; **an edit
  re-embeds only changed chunks** (counted on the fake embedder); a tombstone leaves the results; **another
  project's identical text never appears**.
- `tasks/memory-embed.test.ts` — duplicate enqueues embed once; a superseded version is skipped; the
  backlog finds orphans round-robin; a revision bump plus `reindex` re-embeds; `scope: chunks` rebuilds
  `searchText`.
- `actions/memory-stats.test.ts`, `channels/project-memory.test.ts` (ingest frames carry no content),
  `bots/tools/memory-search.test.ts` and `memory-add.test.ts` (tags, envelopes, replay returns the same job).
- `embedding/real-model.test.ts` — run only with `EMBEDDER=real` in the eval job: 384-d unit vectors, and a
  related pair outscoring an unrelated one.
- `cli/__tests__/memory-add.test.ts` — include/exclude, skips, mapping, URL refusal, `--dry-run`, and an
  idempotent re-run.
- `frontend/e2e/memory-upload.spec.ts` — drop a PDF, watch the job finish live, find a phrase from it.
- **Eval:** `backend/scripts/eval-search.ts` ports membot's harness and fixtures against Postgres with the
  real model; variants `hybrid`, `keyword`, `semantic`, `multitenant`; a CI `eval` job after backend tests
  runs `--ci` with cached weights, starting at membot's thresholds and re-based on the measured 2.0 baseline.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Then `cd backend && EMBEDDER=real bun run eval --ci`. Manually:

1. Drag a folder with a PDF, a DOCX, an XLSX, and a PPTX onto `research/` in the Memory page. Each job moves
   `queued → running → succeeded` without a reload; the files render as markdown.
2. Search for a phrase that appears only inside the PDF, in hybrid mode; then ask a question that uses none
   of its words; both land on it, with a snippet around the match.
3. `botholomew memory add ./notes --prefix notes --exclude '**/*.tmp' --wait`, then run it again: every file
   reports `unchanged`.
4. Rename `research/` to `archive/research/`; search still finds the PDF under the new path once its chunks
   re-embed (`memory stats` shows pending, then zero).
5. Ask Botholomew in chat to find the PDF's conclusion; the transcript shows `memory_search` then
   `memory_cat`.

Then the edge cases:

- Drop an image: refused, naming the supported types. Drop a 30 MiB PDF: refused before it is stored.
- Kill the worker mid-conversion; within a few minutes the sweep requeues the job and it succeeds.
- Edit one paragraph of a long note; stats show only a few chunks pending.
- As an admin, `botholomew memory reindex`; progress appears in Settings → Memory and stats.
- Check worker and API resident memory on staging with the model loaded, and adjust instance sizes.

## Definition of done

- [ ] `memory_chunks` with the partial HNSW and GIN indexes; `memory_ingest_jobs`; settings and
      `descriptionDerived` columns
- [ ] Chunking inside every text write, with vector reuse by `searchText` sha; moves re-embed
- [ ] Embedder on a dedicated thread, WASM everywhere, weights baked into the image; query cache; fake
      embedder for tests
- [ ] `memory:embed` bounded and idempotent; `memory:embed-backlog` reconciles fairly; revision and
      `memory:reindex` (embeddings, chunks) with progress
- [ ] Hybrid search ported (RRF 0.6, `maxPerFile` with backfill, snippets, modes, prefix, history) with
      `semanticCoverage`; iterative HNSW scans; keyword fallback during backfill
- [ ] Deterministic converters for text, structured text, HTML, PDF, DOCX, XLSX, PPTX in a sandboxed
      thread with sniffing and limits; images and binaries refused
- [ ] `memory:upload` (raw, never MCP) and `memory:add` (JSON, MCP); ingest jobs with requestId dedupe, retry,
      and sweep; `memory:stats`
- [ ] `memory_search` (hybrid) and `memory_add` (replay-safe); the memory prompt section complete
- [ ] Upload queue, search modes, info and settings UI; `botholomew memory add/search/jobs/stats/reindex`
- [ ] Eval harness with the multitenant variant and a CI gate; docs; all tests above, twice in a row

## Commands

```bash
botholomew memory add ./papers --prefix research/papers --include '**/*.pdf' --wait
botholomew memory search "how does the pricing model handle refunds" --mode hybrid --prefix research/
botholomew memory search --pattern "SKU-1142" --mode keyword
botholomew memory jobs --status failed && botholomew memory job retry 311
botholomew memory stats research/ --json
bun keryx.ts memory:embed-backlog
psql botholomew -c "select count(*) filter (where embedding is null) as pending, count(*) as total
                    from memory_chunks where project_id = 1 and is_current;"
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
