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
to the chunk's text at embed time, and surface in search results as
the snippet. If the chunker fails, ingestion fails — there is no
sliding-window fallback today.

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

Context gets into Botholomew two ways: local ingestion, and an
LLM-driven loading agent that handles URLs.

### Local files and folders

```bash
# LLM picks a folder for each file based on content + existing structure
botholomew context add ./notes
botholomew context add ./report.pdf

# Explicit placement under a prefix (no LLM call)
botholomew context add ~/Documents/strategy --prefix /strategy
```

`context add` walks directories recursively, detects mime types, and
feeds every file through the ingestion pipeline (item → chunks →
embeddings). Binary files (PDFs, images) are stored in `content_blob`
with `is_textual = false`; textual files are indexed for hybrid search.
Items are stored with `source_type = 'file'` and their original
absolute path in `source_path`.

### Path placement

There are two ways `context add` decides where a file lives in the
virtual filesystem:

- **Explicit** — pass `--prefix <prefix>` (or `--name <path>` for a
  single URL) and the path is derived mechanically (`{prefix}/{basename}`
  for single files, `{prefix}/{relative-path}` for directory walks).
  Same behavior as before.
- **LLM-suggested** (default when `--prefix`/`--name` aren't passed) —
  a single `return_description_and_path` tool-use call produces both a
  description and an absolute folder path per file. The LLM is primed
  with the file's basename, a content excerpt, its source filesystem
  path (for disambiguation when basenames collide — e.g. two projects
  each with a `README.md`), and a summary of existing folders so it
  classifies into the current structure instead of inventing new ones.

  In a TTY, the suggestions are printed and you confirm with `Y`/`n`
  (default accepts — just hit Enter). Pass `--auto-place` to skip the
  prompt; non-TTY invocations (pipes, scripts) accept automatically.

### Collision handling

Before doing anything expensive, `context add` checks each input's
`source_path` (absolute file path for local files, URL for remote items)
against what's already in context. If the same source was ingested
before — whether under the same or a different `context_path` — the
item is routed by `--on-conflict` **before** any LLM placement call, so
re-runs don't burn tokens re-picking paths for files the database
already knows about.

The same `--on-conflict` policy also governs the rarer case where a
newly-placed item's target `context_path` happens to collide with an
unrelated existing item (e.g. two different source files with the same
basename the LLM placed in the same folder).

| Policy      | Behavior                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `error` *(default)* | Fast-fail before LLM placement if any source is already in context. For target-path collisions encountered mid-run, exit with a non-zero status listing every collision. |
| `overwrite` | For already-ingested sources, refresh content from disk/URL (diff + selective re-embed) while preserving the original `context_path`. For target-path collisions, replace and re-embed. |
| `skip`      | Log and move on — no write, no error.                                    |

Re-running `context add` on already-ingested files with the default
policy is a loud error rather than a silent overwrite. Use
`--on-conflict=overwrite` when you genuinely want to refresh stored
content (or `botholomew context refresh` for the idiomatic flow).

The agent-side `context_write` tool follows the same convention:
defaults to `on_conflict='error'` and returns a PATs-style
`error_type: "path_conflict"` with a `next_action_hint` that guides the
agent to `context_read` first or pass `on_conflict='overwrite'`.

### Remote content via a loading agent

URLs aren't `fetch()`d directly. Botholomew runs a focused LLM agent
(`src/context/fetcher.ts`) whose only job is to retrieve the content at
a URL using the MCP tools you have configured:

```bash
botholomew context add https://docs.google.com/document/d/abc123/edit
botholomew context add https://github.com/evantahler/botholomew/issues/42
botholomew context add https://example.com/blog/post

# Override the derived virtual path for a single URL
botholomew context add https://example.com --name /articles/example.md

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
  stores the full content it already has in memory.
- `request_http_fallback()` — terminal. Explicit signal that no MCP
  tool fits; the harness then runs a plain `fetch()` + HTML strip.
- `report_failure(message)` — terminal. Surfaces an actionable message
  back to you ("this Google Doc is private — share it with your service
  account") instead of a silent failure.

If no MCPX client is configured at all, or if the loop exceeds its turn
budget, the fetcher falls back to plain HTTP with a 30s timeout and
extracts `<title>` for textual content.

The origin URL is stored in `context_items.source_path` and
`source_type = 'url'`, so `context list` shows a "Source" column
distinguishing file-backed vs. URL-backed items.

### Refreshing stale content

```bash
botholomew context refresh /docs/strategy.md   # refresh one item
botholomew context refresh --all               # refresh every sourced item
```

`refresh` works for both `file` and `url` source types: for files it
re-reads from disk, for URLs it re-runs the loading agent. In both
cases it compares the new content against what's stored, updates only
when they differ, and re-embeds only the changed items. Missing files
are reported, not silently dropped.

The same logic is exposed to the daemon as the `context_refresh`
tool, so schedules like "every morning at 7, refresh remote context"
work end-to-end without an external scheduler. The tool takes the
same arguments as the CLI (`path` for a single item or subtree,
`all: true` for every sourced item) and returns a structured summary
(`checked`, `updated`, `unchanged`, `missing`, `reembedded`,
`chunks`, per-item statuses) so the agent can report back or feed a
downstream task via `complete_task`.

Under the hood, URL fetches from the daemon open a nested fetcher
loop with the project's MCPX client — the same path the CLI uses.
`all: true` across many URLs is serial (each URL runs its own
Anthropic agent loop), so prefer narrowing with `path` when you can.

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
