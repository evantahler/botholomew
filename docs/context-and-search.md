# Context & hybrid search

Botholomew's knowledge layer is real files on disk plus a hybrid
keyword + vector search index built over them. Files are the source of
truth; `index.duckdb` is a derivable sidecar — delete it and rebuild
any time. It's how the agent finds "that thing I mentioned last week"
across thousands of ingested documents without calling out to a vector
DB service.

---

## The pipeline

When you add a document (`botholomew context add ./report.pdf` or the
agent writes via `context_write`), this happens:

```
 content ─► write file under context/<path>
         ─► LLM-driven chunker (claude-haiku-4-5 by default)
         ─► embedder (local @huggingface/transformers, default Xenova/bge-small-en-v1.5, 384-dim)
         ─► context_index rows (one per chunk, FLOAT[384] vector)
         ─► rebuild FTS index (BM25 over chunk_content + title)
         ─► sha256 content hash stored alongside, for drift detection
```

See `src/context/ingest.ts`, `src/context/chunker.ts`,
`src/context/embedder.ts`, and `src/context/reindex.ts`.

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

Each chunk is embedded separately; the file's first heading becomes the
chunk's `title`, prepended to the chunk's text at embed time (along
with a `Source: <path>` line) so it surfaces in search results as the
snippet. If the chunker errors or times out, ingestion falls back to a
deterministic paragraph/line splitter (`chunkByTextSplit` in
`src/context/chunker.ts`) — semantic quality suffers, but the file
still gets indexed.

---

## Storage

The source of truth is **files under `context/`**. Whatever you put
there — text, markdown, JSON, source code — is what the agent reads
and edits. There is no separate "context items" table.

The search index lives in `index.duckdb` next to the project root in a
single table:

```sql
CREATE TABLE context_index (
  path           TEXT NOT NULL,            -- project-relative path under context/
  chunk_index    INTEGER NOT NULL,
  chunk_content  TEXT,
  title          TEXT,                     -- file's first heading, used in BM25
  embedding      FLOAT[384],
  content_hash   TEXT,                     -- sha256 of the file at index time
  mtime          TEXT,
  size           INTEGER,
  PRIMARY KEY (path, chunk_index)
);
```

`(path, chunk_index)` is the only identity key; `content_hash` is what
makes incremental reindex efficient — `botholomew context reindex`
walks `context/`, hashes each file, and only re-embeds the ones whose
hash changed.

The walk follows user-placed symlinks: a symlinked file at
`context/ref.md` indexes as `ref.md`, and a symlinked directory's
children are recursed into and stored under the link's path (e.g.
`linked/deep.md`). Cycles are detected via a `dev:ino` visited set
seeded from the walk root, and recursion is capped at 32 levels. See
[files.md](files.md) for the read/write contract on symlinks.

Vector similarity uses `array_cosine_distance` — a core DuckDB
function, no extension required. There is no HNSW index: at our scale
(hundreds to low thousands of rows) a linear scan beats the
operational cost of the experimental-persistence HNSW path, which has
bitten us with intermittent corruption more than once. Revisit when
row counts reach the millions.

Keyword search uses the **DuckDB FTS extension** (`INSTALL fts; LOAD
fts;`) for BM25 ranking over `chunk_content` and `title`. The FTS
index is a **snapshot** — it does not update incrementally on
INSERT/DELETE. Every writer calls `rebuildSearchIndex(conn)` from
`src/db/embeddings.ts` after its transaction commits.

---

## Hybrid search

`hybridSearch()` in `src/db/embeddings.ts` combines two signals:

1. **Keyword** — `fts_main_context_index.match_bm25(query)` over
   `chunk_content` and `title`. BM25 handles tokenization, stemming,
   stopwords, and length-normalized scoring, so multi-term queries
   strictly *increase* recall over single-term queries.
2. **Vector** — `array_cosine_distance(embedding, $query_embedding)`
   via a linear scan over the `context_index` table.

Results are merged with reciprocal rank fusion (k=60) and returned as
`(path, title, score, snippet)`.

## The `search` tool

The agent has a single `search` tool that fuses three signals:
**regexp** over the files in `context/`, **BM25 keyword**, and
**vector similarity**. At least one of `query` (natural language) or
`pattern` (regex) is required; passing both is the strongest signal.
Scoping (`path`, `glob`) applies to both sides.

The execute path:

1. If `pattern` is set, run `runRegexp()` over files in `context/`
   (scoped by path/glob when given). Each hit is a `(path, line)` pair
   with the matched line and any requested context lines.
2. If `query` is set, run `embedSingle()` then `hybridSearch()` (BM25 +
   vector via reciprocal rank fusion). Apply `path` / `glob` as a
   post-filter so scoping is consistent across sides.
3. Fuse via `fuseRRF()` in `src/tools/search/fuse.ts` (k=60). Each
   regexp hit gets its rank contribution; if the same path also
   appears in the semantic results, that side's rank contribution is
   added too and the row is tagged `match_type: "both"`. Pure-semantic
   chunks for files the regexp didn't touch are emitted as their own
   rows (`match_type: "semantic"`, `line: null`).

Each match has shape:

```ts
{
  path,
  line: number | null,            // null for pure-semantic chunks
  content,                        // matched line OR chunk snippet (300 chars)
  context_lines,                  // grep neighbors when context > 0
  match_type: "regexp" | "semantic" | "both",
  semantic_score: number | null,  // raw hybridSearch RRF, null for regexp-only
  score                           // unified fused RRF score
}
```

The CLI exposes the same hybrid search via
`botholomew context search "..." --pattern <regex>` — pass a
positional query, `--pattern`, or both.

---

## Contextual loading

When a worker picks up a task, `buildSystemPrompt()`
(`src/worker/prompt.ts`) doesn't just dump every file into the prompt
— that would blow the context window. Instead:

1. All markdown files in `prompts/` with frontmatter `loading: always`
   are included verbatim. New projects ship with `goals.md`,
   `beliefs.md`, and `capabilities.md`, but anything you add to
   `prompts/` that parses is treated the same way.
2. The task name + description is embedded.
3. `hybridSearch()` finds top-N relevant chunks from the index.
4. Those chunks are appended to the system prompt as task-specific
   context, labelled with their path so the agent can jump to the full
   file via `context_read`.
5. Markdown files in `prompts/` with `loading: contextual` are included
   only if their content shares keywords with the task.

---

## Loading context

Context gets into Botholomew two ways: local file import, and an
LLM-driven loading agent that handles URLs. In both cases the result
is a real file under `context/` and rows in `context_index`.

### Local files and folders

```bash
botholomew context add ./notes               # walks the directory
botholomew context add ./report.pdf          # single file
botholomew context add ~/Documents/strategy
```

`context add` walks directories recursively, detects mime types, and
copies every file into `context/` under a path derived from the
source. Each file is then chunked, embedded, and indexed.

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
  agent picks which captured exec result to save by its id and reports
  the source `mime_type`; the harness stores the full content it
  already has in memory and writes it under `context/` at a path
  derived from the URL.
- `request_http_fallback()` — terminal. Explicit signal that no MCP
  tool fits; the harness then runs a plain `fetch()`.
- `report_failure(message)` — terminal. Surfaces an actionable message
  back to you ("this Google Doc is private — share it with your service
  account") instead of a silent failure.

The fetcher prompt steers the agent toward markdown-emitting MCP tools
first (names containing `markdown`/`md`/`AsMarkdown`/`AsDocmd`) and to
request a markdown `format` parameter when the schema exposes one.

**Markdown is enforced at storage time.** When the agent calls
`accept_content`, the harness runs a single-shot LLM conversion to
clean Markdown before writing the file — regardless of the mime type
the tool claimed. MCP tools frequently mislabel their output (Google
Docs' "Docmd" tool, for example, claims `text/markdown` but returns a
proprietary `[H1 ...]` annotation format), so the converter does the
verification: if the input is already clean Markdown the model echoes
it unchanged; otherwise it converts, with explicit handling for HTML,
JSON, XML, DocMD, and other common formats. Plain-text bodies from the
HTTP fallback short-circuit (saved as `text/plain`, no API call).
Conversion errors are non-fatal — the import logs a warning and saves
the raw content so you can edit it by hand.

If no MCPX client is configured at all, or if the loop exceeds its turn
budget, the fetcher falls back to plain HTTP with a 30s timeout and
extracts `<title>` for HTML pages. With an Anthropic API key
configured, HTML is converted to Markdown; without one, tags are
stripped and the result is saved as `text/plain`.

### Collision handling

Before doing anything expensive, `context add` checks whether the
target path already exists under `context/`. If so, the item is routed
per `--on-conflict`:

| Policy      | Behavior                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `error`     | Fast-fail if any target path already exists. |
| `overwrite` | Refresh content from the origin (diff + selective re-embed). |
| `skip` *(default)* | Log and move on — no write, no error. |

Re-running `context add` on already-ingested files is a no-op by
default. Use `--on-conflict=overwrite` when you want to refresh stored
content (or `botholomew context refresh` for the idiomatic flow), and
`--on-conflict=error` when you want a hard failure on collisions.

The agent-side `context_write` tool follows the same convention:
defaults to `on_conflict='error'` and returns a PATs-style
`error_type: "path_conflict"` with a `next_action_hint` that guides the
agent to `context_read` first or pass `on_conflict='overwrite'`.
On success, `context_write` also returns a `tree` field — a
`context_tree` snapshot — so the agent can see what else is nearby
without a follow-up call.

### Piping a tool's output straight into context

When the agent wants a *large* tool output to be searchable for later
but does not need to read the bytes itself, `pipe_to_context` is the
recommended path. It dispatches another tool (e.g. `search_grep`,
`mcp_exec`, `context_refresh`), captures the stringified result, and
writes it under `context/` at a target path — chunked, embedded, and
indexed for hybrid search. The model only sees a small ack (path, byte
count, 200-char preview), so a multi-megabyte payload doesn't burn the
conversation budget. Terminal tools and `pipe_to_context` itself are
rejected; if the inner tool errors, nothing is written. See
[tools.md](tools.md#pipe_to_context--pipe-a-tools-output-straight-into-context)
for the full contract.

### Refreshing stale content

```bash
botholomew context refresh notes/strategy.md   # project-relative path under context/
botholomew context refresh docs/*.md           # multiple paths (shell glob)
botholomew context refresh --all               # every URL-sourced file
```

`refresh` looks up each file's `source_url` (stored as YAML frontmatter
on the file at ingest time):

- Files imported from local disk (no `source_url`) are skipped — edit
  them directly.
- Files with a `source_url` re-run the loading agent against that URL.

In all cases refresh compares the new content against what's stored,
updates only when they differ, and re-embeds only the changed files.
Missing sources are reported, not silently dropped.

The same logic is exposed to the agent as the `context_refresh` tool,
which takes `path` (a single file or a directory prefix) or
`all: true` and returns a structured summary along with a
post-refresh `tree` snapshot.

---

## Local embeddings

Botholomew runs embeddings locally via
[`@huggingface/transformers`](https://huggingface.co/docs/transformers.js).
The default model is `Xenova/bge-small-en-v1.5` (384-dim, ~33 MB).
Weights are downloaded the first time the model is used and cached
under the project's `models/` directory — subsequent runs load from
disk in milliseconds.

No API key, no per-token cost, no network dependency at query time. The
model loads lazily on the first embed call, so CLI startup stays fast.

ONNX Runtime runs in **WASM** mode (`onnxruntime-web`) rather than the
default native `onnxruntime-node` bindings, because the native bindings
segfault under Bun when another native module (DuckDB) is loaded in the
same process — see [oven-sh/bun#26081](https://github.com/oven-sh/bun/issues/26081).
The switch is implemented as a `bun patch` against
`@huggingface/transformers` (see `patches/`) plus a `wasmPaths` override
in `src/context/embedder-impl.ts` that points the WASM loader at the
`onnxruntime-web/dist/` files already on disk — no CDN fetch at runtime.

> **One shared transformers.** `@evantahler/mcpx` also embeds (for
> `mcp_search`'s semantic tool index) and aligned its dep on
> `^4.2.0` from v0.19.0 onward, so Bun dedupes to a single copy that
> our patch covers. If a future mcpx bump diverges to a different major,
> a second patch will be needed for the nested copy.

> **Maintaining the patch.** Run `bun patch '@huggingface/transformers@<version>'`,
> reapply the two edits in `src/backends/onnx.js` (drop the static
> `onnxruntime-node` import; route the `IS_NODE_ENV` branch to `ONNX_WEB`
> with `wasm` defaults), then `bun patch --commit`. The `embedder.test.ts`
> regression case (DuckDB + embedder in the same process) catches it
> if the patch ever stops applying.

To use a different model, set `embedding_model` and `embedding_dimension`
in `config/config.json`. Any feature-extraction model from the
Xenova/* namespace works — for example, `Xenova/multilingual-e5-small`
(also 384-dim) handles mixed-language content much better than the
default.

Changing models means old vectors and new vectors live in different
embedding spaces and aren't comparable. Run
`botholomew context reindex --full` to rebuild every vector with the
new model.

History: an older milestone shipped with OpenAI
`text-embedding-3-small` (1536-dim) for quality reasons. Local
embeddings reverted that decision — modern small open-source models
close the quality gap, and "no API key required" is more in line with
Botholomew's local positioning.
