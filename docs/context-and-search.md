# Context & hybrid search

Botholomew's knowledge layer is a hybrid keyword + vector search system
backed entirely by DuckDB. It's how the agent finds "that thing I
mentioned last week" across thousands of ingested documents without
calling out to a vector DB service.

---

## The pipeline

When you add a document (`botholomew context add ./report.pdf` or the
agent writes via `context_write`), this happens:

```
 content ─► create context_item row  (drive, path)
         ─► LLM-driven chunker (claude-haiku-4-5 by default)
         ─► embedder (OpenAI text-embedding-3-small, 1536-dim)
         ─► embeddings table (FLOAT[1536])
         ─► rebuild FTS index (BM25 over chunk_content + title)
         ─► indexed_at set on the context_item
```

See `src/context/ingest.ts`, `src/context/chunker.ts`, and
`src/context/embedder.ts`.

---

## LLM-driven chunking

Fixed-size sliding-window chunking shreds structure: a heading lands in
one chunk, its bullets in another, and semantic search returns incoherent
fragments. Botholomew instead asks a **small, fast** model (Haiku by
default) to propose chunk boundaries for each document:

```json
{
  "chunks": [
    { "start_line": 1,   "end_line": 42  },
    { "start_line": 43,  "end_line": 98  }
  ]
}
```

The chunker only returns line ranges (1-based, inclusive) — see
`CHUNKER_TOOL` in `src/context/chunker.ts`.

Each chunk is embedded separately; the `title` and `description` come
from the parent `context_item` (set at ingestion time), are prepended
to the chunk's text at embed time (along with a `Source: drive:/path`
line), and surface in search results as the snippet. If the chunker
fails, ingestion fails — there is no sliding-window fallback today.

---

## Storage

Context items live in `context_items` with a single identity key:

```sql
CREATE TABLE context_items (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT,
  mime_type  TEXT NOT NULL DEFAULT 'text/plain',
  drive      TEXT NOT NULL,
  path       TEXT NOT NULL,
  indexed_at TEXT,
  ...
);
CREATE UNIQUE INDEX idx_context_items_drive_path
  ON context_items(drive, path);
```

That unique index is load-bearing: `context add` looks up `(drive, path)`
on every input to decide whether the ingest is a new insert or a refresh
of an existing row.

Embeddings live in `embeddings`:

```sql
CREATE TABLE embeddings (
  id               TEXT PRIMARY KEY,
  context_item_id  TEXT NOT NULL,
  chunk_index      INTEGER NOT NULL,
  chunk_content    TEXT,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  embedding        FLOAT[1536],
  created_at       TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  UNIQUE(context_item_id, chunk_index)
);
```

Vector similarity uses `array_cosine_distance` — a core DuckDB function,
no extension required. There is no HNSW index: at our scale (hundreds
to low thousands of rows) a linear scan beats the operational cost of
the experimental-persistence HNSW path, which has bitten us with
intermittent corruption more than once. Revisit when row counts reach
the millions.

Keyword search uses the **DuckDB FTS extension** (`INSTALL fts; LOAD
fts;`) for BM25 ranking over `chunk_content` and `title`. The FTS index
is a **snapshot** — it does not update incrementally on INSERT /
DELETE. Every writer must call `rebuildSearchIndex(conn)` from
`src/db/embeddings.ts` after its transaction commits. The ingest
pipeline (`src/context/ingest.ts`) is the only writer today and does
this automatically.

---

## Hybrid search

`hybridSearch()` in `src/db/embeddings.ts` combines two signals:

1. **Keyword** — `fts_main_embeddings.match_bm25(id, query)` over
   `chunk_content` and `title`. BM25 handles tokenization, stemming,
   stopwords, and length-normalized scoring, so multi-term queries
   strictly *increase* recall over single-term queries.
2. **Vector** — `array_cosine_distance(embedding, $query_embedding)`
   via a linear scan over the `embeddings` table.

Results are merged with reciprocal rank fusion (k=60), joined back to
`context_items` to pick up each hit's `drive` and `path`, and returned
as `(ref, title, score, snippet)`.

Exposed to the agent as `search_semantic` and `search_grep`, and to
you as `botholomew context search "..."`.

---

## Drives

Every context item lives under a **drive** — the name of its origin.
The built-in drives are:

| Drive | What lives there | Refreshable? |
|---|---|---|
| `disk`       | Local files (path = absolute filesystem path) | yes (re-reads from disk) |
| `url`        | Generic HTTP(S) pages (path = full URL) | yes (re-fetches) |
| `agent`      | Agent-authored scratch content | no (no external origin) |
| `google-docs` | Google Docs documents (path = doc id) | not yet |
| `github`     | GitHub repo content (path = /owner/repo/...) | not yet |

Drive detection lives in `src/context/drives.ts`. `detectDriveFromUrl`
inspects the URL (and optionally the MCP server name that served the
content) and returns the right `(drive, path)` pair. To add a new
drive, extend that function with a new pattern.

A refresh dispatch that isn't yet implemented (`google-docs`, `github`)
returns a per-item `error` so the user knows to re-add the URL
explicitly. Those items are still fully searchable — they just aren't
auto-refreshable yet.

---

## Contextual loading

When a worker picks up a task, `buildSystemPrompt()`
(`src/worker/prompt.ts`) doesn't just dump every context file into the
prompt — that would blow the context window. Instead:

1. All markdown files with frontmatter `loading: always` are included
   verbatim (e.g., `soul.md`, `beliefs.md`, `goals.md`).
2. The task name + description is embedded.
3. `hybridSearch()` finds top-N relevant chunks from the database.
4. Those chunks are appended to the system prompt as task-specific
   context, labelled with their `drive:/path` ref so the agent can
   jump to the full item via `context_read`.
5. Markdown files with `loading: contextual` are included only if their
   content shares keywords with the task.

---

## Loading context

Context gets into Botholomew two ways: local ingestion, and an
LLM-driven loading agent that handles URLs. There is **no LLM
placement** — the origin of the content determines its (drive, path)
directly.

### Local files and folders

```bash
botholomew context add ./notes               # walks the directory
botholomew context add ./report.pdf          # single file
botholomew context add ~/Documents/strategy
```

`context add` walks directories recursively, detects mime types, and
feeds every file through the ingestion pipeline (item → chunks →
embeddings). Every local file is stored with:

- `drive = "disk"`
- `path = <absolute filesystem path>`

Binary files (PDFs, images) are stored in `content_blob` with
`is_textual = false`; textual files are indexed for hybrid search.

### Remote content via a loading agent

URLs aren't `fetch()`d directly. Botholomew runs a focused LLM agent
(`src/context/fetcher.ts`) whose only job is to retrieve the content at
a URL using the MCP tools you have configured:

```bash
botholomew context add https://docs.google.com/document/d/abc123/edit
botholomew context add https://github.com/evantahler/botholomew/blob/main/README.md
botholomew context add https://example.com/blog/post

# Hand the fetcher extra guidance (auth notes, tool hints, etc.)
botholomew context add https://internal.corp/doc \
  --prompt-addition "Use the corp-wiki MCP server, not Firecrawl"
```

The fetcher runs a tool-use loop (up to 10 turns) with a small tool set:

- `mcp_list_tools` / `mcp_search` — discover which MCP tools are
  available and which might handle this URL.
- `mcp_info` — read a tool's input schema before calling it.
- `mcp_exec` — execute an MCP tool. The harness captures the full
  result and sends the LLM **only a 2,000-char preview**, keyed by the
  call's `tool_use_id`. Large pages don't explode the context window.
- `accept_content(exec_call_id, title, mime_type?)` — terminal. The
  agent picks which captured exec result to save by its id; the harness
  stores the full content it already has in memory. At save time the
  harness consults `detectDriveFromUrl(url, serverName)` to assign the
  right drive (e.g. `google-docs:/<docId>` when the Google Docs MCP
  served the content).
- `request_http_fallback()` — terminal. Explicit signal that no MCP
  tool fits; the harness then runs a plain `fetch()` + HTML strip.
- `report_failure(message)` — terminal. Surfaces an actionable message
  back to you ("this Google Doc is private — share it with your service
  account") instead of a silent failure.

If no MCPX client is configured at all, or if the loop exceeds its turn
budget, the fetcher falls back to plain HTTP with a 30s timeout and
extracts `<title>` for textual content. HTTP-fallback items live under
drive `url`.

### Collision handling

Before doing anything expensive, `context add` checks each input's
`(drive, path)` against what's already in context. If the same
`(drive, path)` is already ingested, the item is routed per
`--on-conflict`:

| Policy      | Behavior                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `error`     | Fast-fail if any input is already in context. |
| `overwrite` | Refresh content from the origin (diff + selective re-embed). |
| `skip` *(default)* | Log and move on — no write, no error. |

Re-running `context add` on already-ingested items is a no-op by
default. Use `--on-conflict=overwrite` when you want to refresh stored
content (or `botholomew context refresh` for the idiomatic flow), and
`--on-conflict=error` when you want a hard failure on collisions.

The agent-side `context_write` tool follows the same convention:
defaults to `on_conflict='error'` and returns a PATs-style
`error_type: "path_conflict"` with a `next_action_hint` that guides the
agent to `context_read` first or pass `on_conflict='overwrite'`.
On success, `context_write` also returns a `tree` field — a
`context_tree` snapshot of the current drive — so the agent can see
what else is nearby without a follow-up call.

### Refreshing stale content

```bash
botholomew context refresh disk:/Users/evan/notes/strategy.md
botholomew context refresh README.md           # bare path → resolves to disk:/<abs>
botholomew context refresh docs/*.md           # multiple paths (shell glob)
botholomew context refresh --all               # every non-agent item
```

`refresh` dispatches on the drive:

- `disk` → re-reads from the filesystem.
- `url` → re-runs the loading agent.
- `agent` → skipped (no external origin).
- `google-docs` / `github` → returns a per-item error today (not yet
  implemented). Re-add from the original URL if you need a fresh copy.

In all cases it compares the new content against what's stored, updates
only when they differ, and re-embeds only the changed items. Missing
files are reported, not silently dropped.

The same logic is exposed to the agent as the `context_refresh` tool,
which takes `ref` (a UUID, `drive:/path`, or `drive:/prefix` for a
subtree) or `all: true` and returns a structured summary along with a
post-refresh `tree` snapshot.

---

## Why OpenAI for embeddings?

Earlier milestones used a local `@xenova/transformers` model
(`bge-small-en-v1.5`, 384-dim). It worked but had drawbacks: ~500 MB of
model weights, slow CPU inference on first load, and noticeably worse
quality on mixed-language content. Migration 5
(`5-reset_embeddings_for_openai.sql`) switched to OpenAI
`text-embedding-3-small` at 1536 dimensions — faster, better, and only
"non-local" for the index-time call. Queries at runtime still only need
an embedding of the query string itself.

If you want a fully-local setup, swap `src/context/embedder.ts` for a
local model and adjust `EMBEDDING_DIMENSION` in `src/constants.ts` —
everything downstream (VSS, HNSW, hybrid search) is dimension-agnostic.
