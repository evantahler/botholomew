# Context & hybrid search

Botholomew's knowledge layer is a hybrid keyword + vector search system
backed entirely by DuckDB. It's how the agent finds "that thing I
mentioned last week" across thousands of ingested documents without
calling out to a vector DB service.

---

## The pipeline

When you add a document (`botholomew context add ./report.pdf` or the
agent writes via `file_write`), this happens:

```
 content ─► create context_item row
         ─► LLM-driven chunker (claude-haiku-4-5 by default)
         ─► embedder (OpenAI text-embedding-3-small, 1536-dim)
         ─► embeddings table (FLOAT[1536] + HNSW index)
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
[
  { "start": 0,   "end": 412, "title": "Q4 Overview",     "description": "..." },
  { "start": 413, "end": 980, "title": "Revenue by region", "description": "..." },
  ...
]
```

The chunker has a sliding-window fallback (500 tokens, 50 overlap) if the
LLM call fails, so ingestion never blocks on model availability.

Each chunk is embedded separately; the `title` and `description` are
stored alongside the embedding and surface in search results as the
snippet.

---

## Storage

Embeddings live in the `embeddings` table (see
`src/db/sql/1-core_tables.sql`):

```sql
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  context_item_id TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  chunk_content   TEXT,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  source_path     TEXT,
  embedding       FLOAT[1536],
  created_at      TEXT NOT NULL DEFAULT (current_timestamp::VARCHAR),
  UNIQUE(context_item_id, chunk_index)
);
```

The VSS extension provides an HNSW index with cosine distance
(`src/db/sql/6-vss_index.sql`):

```sql
CREATE INDEX IF NOT EXISTS idx_embeddings_cosine
  ON embeddings USING HNSW (embedding) WITH (metric = 'cosine');
```

`SET hnsw_enable_experimental_persistence = true;` is run at connection
time so the index survives process restarts instead of being rebuilt
every time.

---

## Hybrid search

`hybridSearch()` in `src/db/embeddings.ts` combines two signals:

1. **Keyword** — `LIKE` match on `chunk_content`, `title`, `description`.
2. **Vector** — `array_cosine_distance(embedding, $query_embedding)` via
   the HNSW index, which turns what would be a full scan into a
   logarithmic probe.

Results are merged, de-duplicated by `(context_item_id, chunk_index)`,
and re-ranked. Keyword hits get a score boost when the user's query
contains a rare token — so "AGM-84" finds the exact match, not the
semantically-nearest chunk about missiles.

Exposed to the agent as `search_semantic` and `search_grep`, and to you
as `botholomew context search "..."`.

---

## Contextual loading

When the daemon picks up a task, `buildSystemPrompt()`
(`src/daemon/prompt.ts`) doesn't just dump every context file into the
prompt — that would blow the context window. Instead:

1. All markdown files with frontmatter `loading: always` are included
   verbatim (e.g., `soul.md`, `beliefs.md`, `goals.md`).
2. The task name + description is embedded.
3. `hybridSearch()` finds top-N relevant chunks from the database.
4. Those chunks are appended to the system prompt as task-specific
   context.
5. Markdown files with `loading: contextual` are included only if their
   content shares keywords with the task.

The result is a prompt that's always grounded in the agent's identity
(`soul.md`), learned priors (`beliefs.md`), and whatever historical
context is most relevant to the task at hand.

---

## Loading context

Context gets into Botholomew two ways: local ingestion, and a remote
loading agent that handles URLs.

### Local files and folders

```bash
botholomew context add ./notes
botholomew context add ./report.pdf
botholomew context add ~/Documents/strategy --prefix /strategy
```

`context add` walks directories recursively, detects mime types, and
feeds every file through the ingestion pipeline (item → chunks →
embeddings). Binary files (PDFs, images) are stored in `content_blob`
with `is_textual = false`; textual files are indexed for hybrid search.
Re-running `context add` on the same path updates in place — re-chunks,
re-embeds, and replaces — so running it on a cron is a valid way to
keep a folder mirrored.

### Remote content via a loading agent

URLs aren't just `fetch()`d — Botholomew runs a small LLM-driven agent
whose only job is to fetch the content at a URL:

```bash
botholomew context add https://docs.google.com/document/d/abc123/edit
botholomew context add https://github.com/evantahler/botholomew/issues/42
botholomew context add https://example.com/blog/post
```

The loader agent:

1. Inspects the URL and the list of configured MCP tools.
2. Picks the best tool for the job — Google Docs tools for a Google
   Docs link, a GitHub MCP server for GitHub URLs, a generic web
   fetcher or Arcade-gateway tool for everything else.
3. Calls that tool, cleans up the content, and hands it to the normal
   ingestion pipeline.
4. Falls back to a plain HTTP `fetch()` + HTML strip if no MCP tool
   wants the URL.

The origin is stored in `context_items.source_path` (and
`source_type = 'url'`), so provenance is tracked end-to-end.

### Refreshing on a schedule

Remote content goes stale. Two ways to keep it fresh:

```bash
botholomew context refresh                    # refresh every url item
botholomew context refresh /docs/strategy.md  # refresh one item
botholomew context refresh --stale 7d         # only items older than 7 days
```

Refresh re-fetches via the same loading agent, compares against stored
content, and re-ingests only when there's a change. To run it
automatically, create a schedule:

```bash
botholomew schedule add "Refresh remote context" \
  --frequency "every morning" \
  --description "Run context refresh --stale 1d and report any items that changed"
```

The daemon will evaluate the schedule on its next tick and enqueue the
refresh task.

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
