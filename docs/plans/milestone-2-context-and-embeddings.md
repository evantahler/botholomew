# Milestone 2: Context & Embeddings

## Goal

Build the knowledge management foundation — the ability to ingest, chunk, embed, and search content. This is Botholomew's core differentiator: a local hybrid search system that makes the agent's context rich and relevant.

## What Gets Unblocked

- The daemon can search relevant context when working tasks
- The operator can feed the agent documents, URLs, and files
- "Contextual" loading mode works (system prompt includes relevant context per-task)

---

## New Dependency

Add `@xenova/transformers` to `package.json` for local embedding generation using `Xenova/bge-small-en-v1.5` (384-dim vectors).

---

## Implementation

### 1. Context CRUD (`src/db/context.ts`)

Replace the stub with full implementation:

- `createContextItem(conn, { title, content?, contentBlob?, mimeType, sourcePath, contextPath })` — insert a context item
- `getContextItem(conn, id)` — fetch by ID
- `listContextItems(conn, { contextPath?, mimeType?, limit? })` — list with filters
- `updateContextItem(conn, id, updates)` — update fields
- `deleteContextItem(conn, id)` — delete item and its embeddings
- `searchContextByKeyword(conn, query, limit?)` — full-text search on title + content

### 2. Embedding Pipeline (`src/context/`)

New module at `src/context/` for the ingestion pipeline:

**`src/context/embedder.ts`**
- Load `Xenova/bge-small-en-v1.5` via `@xenova/transformers` pipeline
- `embed(texts: string[])` — batch embed, returns `number[][]`
- Singleton model loading (load once, reuse across calls)

**`src/context/chunker.ts`**
- `chunkContent(conn, config, content, mimeType)` — sends content to Claude to decide chunk boundaries
- Claude returns a structured response: array of `{ start, end, title, description }` for each chunk
- Falls back to sliding window (500 tokens, 50 overlap) if LLM call fails

**`src/context/ingest.ts`**
- `ingestContent(conn, config, params)` — full pipeline:
  1. Create context item in DB
  2. Send content to LLM for chunking decisions
  3. Chunk the content
  4. Embed each chunk via `embedder.ts`
  5. Store embeddings in DB
  6. Update `indexed_at` on context item
- Handle both text and binary (for binary: extract text first or store description-only embedding)

### 3. Embeddings CRUD (`src/db/embeddings.ts`)

Replace the stub with full implementation:

- `createEmbedding(conn, { contextItemId, chunkIndex, chunkContent, title, description, sourcePath, embedding })` — insert
- `deleteEmbeddingsForItem(conn, contextItemId)` — remove all chunks for a context item
- `searchEmbeddings(conn, queryEmbedding, limit?)` — vector similarity search via DuckDB VSS
- `hybridSearch(conn, query, queryEmbedding, limit?)` — combine keyword search on chunk_content/title with vector similarity, merge and re-rank results

### 4. VSS Extension Management

In `src/db/schema.ts`, improve `installVss()`:
- Try to install/load the vss extension
- If available, create the HNSW index
- Track in `daemon_state` whether VSS is available
- `searchEmbeddings` falls back to brute-force cosine similarity in SQL if VSS unavailable:
  ```sql
  SELECT *, list_cosine_similarity(embedding, $query) AS score
  FROM embeddings ORDER BY score DESC LIMIT $limit
  ```

### 5. Context CLI Commands (`src/commands/context.ts`)

Replace stubs:

- `botholomew context list [--path <prefix>]` — list all context items, filterable by virtual path
- `botholomew context add <path>` — ingest a file or directory recursively
  - Detect mime type from extension
  - For directories, walk and ingest each file
  - Show progress with spinner
- `botholomew context search <query>` — hybrid search: embed the query, search both keyword and vector, display ranked results with snippets
- `botholomew context view <id>` — show context item details and its chunks
- `botholomew context remove <id>` — delete a context item and its embeddings

### 6. Contextual Loading in System Prompt (`src/daemon/prompt.ts`)

Extend `buildSystemPrompt()`:
- Still load all `loading: always` markdown files
- When a task is provided, search context items relevant to the task name + description:
  1. Embed the task text
  2. Run `hybridSearch` with the embedding
  3. Include top-N results as additional context in the system prompt
- Also load `loading: contextual` markdown files if their content is keyword-relevant to the task

### 7. Daemon Agent Context Tools

Add to `DAEMON_TOOLS` in `src/daemon/llm.ts`:

- `search_context` — search the context database (hybrid search)
- `save_context` — store a piece of content the agent generated (e.g., a summary it produced)
- `list_context` — browse the context virtual filesystem

---

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Add `@xenova/transformers` |
| `src/db/context.ts` | Full CRUD implementation |
| `src/db/embeddings.ts` | Full CRUD + search implementation |
| `src/db/schema.ts` | Improve `installVss()` fallback |
| `src/context/embedder.ts` | **New** — local embedding via transformers |
| `src/context/chunker.ts` | **New** — LLM-driven chunking |
| `src/context/ingest.ts` | **New** — full ingestion pipeline |
| `src/commands/context.ts` | Full CLI implementation |
| `src/daemon/prompt.ts` | Contextual loading for tasks |
| `src/daemon/llm.ts` | Add context tools to daemon |

## Tests

- `test/db/context.test.ts` — context CRUD
- `test/db/embeddings.test.ts` — embedding CRUD, vector search
- `test/context/chunker.test.ts` — chunking strategies
- `test/context/ingest.test.ts` — full pipeline (mock LLM)

## Verification

1. `botholomew context add ./some-folder` — ingests files, shows progress
2. `botholomew context search "quarterly revenue"` — returns ranked results with snippets
3. `botholomew context list` — shows all items with paths
4. Daemon tick with a task referencing a topic — system prompt includes relevant context from the DB
5. Daemon agent uses `search_context` tool during task execution
