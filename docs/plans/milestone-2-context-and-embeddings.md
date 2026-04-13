# Milestone 2: Context & Embeddings

## Goal

Build the knowledge management foundation — the ability to ingest, chunk, embed, and search content. This is Botholomew's core differentiator: a local hybrid search system that makes the agent's context rich and relevant.

The agent interacts with context items through a **virtual filesystem abstraction** — `dir`, `file`, and `search` tools that map to the `context_items` and `embeddings` tables in SQLite. The `context_path` column acts as the file path; `content` is the file body.

## What Gets Unblocked

- The daemon can search relevant context when working tasks
- The operator can feed the agent documents, URLs, and files
- "Contextual" loading mode works (system prompt includes relevant context per-task)
- A reusable **Tool class** pattern that all future tools follow

---

## New Dependencies

- `@xenova/transformers` — local embedding generation using `Xenova/bge-small-en-v1.5` (384-dim vectors)
- `zod` — input/output schema validation for tools
- `zod-to-json-schema` — convert Zod schemas to JSON Schema for Anthropic API tool definitions

---

## Architecture: The Tool Class

Every tool (task, dir, file, search) is an instance of a shared `Tool` base class:

- **Name** and **description** — used for both LLM tool definitions and CLI help text
- **Zod input schema** — per-field descriptions; validates args, generates JSON Schema for Anthropic API, generates Commander options
- **Zod output schema** — strongly typed, guaranteed response format
- **`execute()` method** — the actual implementation (SQLite-backed)

The same Tool definition serves two consumers with thin adapters:
1. **Daemon agent** — Zod input → Anthropic `Tool` JSON Schema; `execute()` called from `executeToolCall()`
2. **CLI** — Zod input → Commander arguments/options; `execute()` called from action handler

### File Structure

```
src/tools/
  tool.ts                 ← Tool base class, registry, adapter utilities
  task/
    complete.ts           ← complete_task tool
    fail.ts               ← fail_task tool
    wait.ts               ← wait_task tool
    create.ts             ← create_task tool
  dir/
    create.ts             ← dir_create tool
    list.ts               ← dir_list tool
    tree.ts               ← dir_tree tool
    size.ts               ← dir_size tool
  file/
    read.ts               ← file_read tool
    write.ts              ← file_write tool
    edit.ts               ← file_edit tool
    delete.ts             ← file_delete tool
    copy.ts               ← file_copy tool
    move.ts               ← file_move tool
    info.ts               ← file_info tool
    exists.ts             ← file_exists tool
    count-lines.ts        ← file_count_lines tool
  search/
    find.ts               ← search_find tool
    grep.ts               ← search_grep tool
    semantic.ts           ← search_semantic tool
```

Each file exports a single Tool instance and self-registers on import. One tool per file.

---

## Implementation

### 1. Tool Base Class (`src/tools/tool.ts`)

- `Tool<TInput, TOutput>` abstract class with `name`, `description`, `group`, `inputSchema`, `outputSchema`, `execute()`
- `toAnthropicTool()` method — converts Zod input schema to Anthropic API JSON Schema via `zod-to-json-schema`
- `ToolContext` interface — `{ conn: DbConnection, projectDir: string, config: Required<BotholomewConfig> }`
- Global registry: `registerTool()`, `getTool()`, `getAllTools()`, `getToolsByGroup()`
- Adapter: `toAnthropicTools()` — returns full `Tool[]` array for the Anthropic API
- Adapter: `registerToolsAsCLI(program)` — auto-generates Commander subcommands from the registry

### 2. Task Tool Migration (`src/tools/task/`)

Migrate the 4 existing hand-written daemon tools to the Tool class:

- `complete_task` — `{ summary: string }` → marks task complete
- `fail_task` — `{ reason: string }` → marks task failed
- `wait_task` — `{ reason: string }` → marks task waiting
- `create_task` — `{ name, description?, priority?, blocked_by? }` → creates subtask

These tools have a `terminal` flag on the class to signal the agent loop should stop.

### 3. Context CRUD (`src/db/context.ts`)

Replace the stub with full implementation:

- `createContextItem(conn, { title, content?, contentBlob?, mimeType, sourcePath, contextPath })` — insert a context item
- `getContextItem(conn, id)` — fetch by ID
- `getContextItemByPath(conn, contextPath)` — fetch by virtual path
- `listContextItems(conn, { contextPath?, mimeType?, limit? })` — list with filters
- `listContextItemsByPrefix(conn, prefix, { recursive?, limit? })` — list items under a path prefix
- `contextPathExists(conn, contextPath)` — check if a path exists
- `getDistinctDirectories(conn, prefix?)` — unique parent paths (for dir listing)
- `updateContextItem(conn, id, updates)` — update fields
- `updateContextItemContent(conn, contextPath, content)` — overwrite content by path
- `applyPatchesToContextItem(conn, contextPath, patches)` — git-style line-range patches
- `copyContextItem(conn, srcPath, dstPath)` — duplicate with new path
- `moveContextItem(conn, oldPath, newPath)` — rename path
- `deleteContextItem(conn, id)` — delete item and its embeddings
- `deleteContextItemByPath(conn, contextPath)` — delete by virtual path
- `deleteContextItemsByPrefix(conn, prefix)` — recursive delete
- `searchContextByKeyword(conn, query, limit?)` — full-text search on title + content

### 4. Directory Tools (`src/tools/dir/`)

| Tool | Input | Output | DB operation |
|------|-------|--------|-------------|
| `dir_create` | `{ path, parents? }` | `{ created: boolean }` | Insert placeholder with `mime_type: "inode/directory"` |
| `dir_list` | `{ path?, recursive? }` | `{ entries: {name, type, size}[] }` | `listContextItemsByPrefix` + `getDistinctDirectories` |
| `dir_tree` | `{ path?, max_items? }` | `{ tree: string }` | `listContextItemsByPrefix(recursive: true)` → render markdown tree |
| `dir_size` | `{ path?, recursive? }` | `{ bytes: number, formatted: string }` | `SUM(length(content))` for items under prefix |

### 5. File Tools (`src/tools/file/`)

| Tool | Input | Output | DB operation |
|------|-------|--------|-------------|
| `file_read` | `{ path, offset?, limit? }` | `{ content: string }` | `getContextItemByPath` → slice lines |
| `file_write` | `{ path, content, title?, description? }` | `{ id, path }` | Upsert via `getContextItemByPath` → create or update |
| `file_edit` | `{ path, patches: Patch[] }` | `{ applied: number, content: string }` | `applyPatchesToContextItem` |
| `file_delete` | `{ path, recursive?, force? }` | `{ deleted: number }` | `deleteContextItemByPath` or `deleteContextItemsByPrefix` |
| `file_copy` | `{ src, dst, overwrite? }` | `{ id, path }` | `copyContextItem` |
| `file_move` | `{ src, dst, overwrite? }` | `{ path }` | `moveContextItem` |
| `file_info` | `{ path }` | `{ id, title, mime_type, is_textual, size, lines, ... }` | `getContextItemByPath` |
| `file_exists` | `{ path }` | `{ exists: boolean }` | `contextPathExists` |
| `file_count_lines` | `{ path }` | `{ lines: number }` | `getContextItemByPath` → count `\n` |

#### Patch Format (`file_edit`)

```typescript
{ start_line: number, end_line: number, content: string }
```

- `start_line` / `end_line`: 1-based inclusive line range
- `end_line: 0` means insert without replacing
- `content: ""` means delete the line range
- Patches applied bottom-up (descending `start_line`) so line numbers stay stable

### 6. Search Tools (`src/tools/search/`)

| Tool | Input | Output | DB operation |
|------|-------|--------|-------------|
| `search_find` | `{ pattern, path?, max_results? }` | `{ matches: string[] }` | `context_path` glob match via SQLite `GLOB` |
| `search_grep` | `{ pattern, path?, glob?, ignore_case?, context?, max_results? }` | `{ matches: {path, line, content, context_lines}[] }` | `LIKE` / application-level regex on `content` |
| `search_semantic` | `{ query, top_k?, threshold? }` | `{ results: {path, title, score, snippet}[] }` | `embed([query])` → `hybridSearch()` |

### 7. Embedding Pipeline (`src/context/`)

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

### 8. Embeddings CRUD (`src/db/embeddings.ts`)

Replace the stub with full implementation:

- `createEmbedding(conn, { contextItemId, chunkIndex, chunkContent, title, description, sourcePath, embedding })` — insert
- `deleteEmbeddingsForItem(conn, contextItemId)` — remove all chunks for a context item
- `searchEmbeddings(conn, queryEmbedding, limit?)` — vector similarity search (brute-force cosine in SQL)
- `hybridSearch(conn, query, queryEmbedding, limit?)` — combine keyword search on chunk_content/title with vector similarity, merge and re-rank results

### 9. Vector Search

SQLite does not have a native vector search extension. Embedding search uses brute-force cosine similarity computed in application code (or via a SQL expression over JSON-encoded float arrays). For the scale of a single-user knowledge base, this is sufficient.

### 10. Embeddings Cascade on Mutations

When content is modified via `file_write`, `file_edit`, `file_move`, or `file_delete`:
- Delete old embeddings for the affected context item
- For write/edit: re-run the ingestion pipeline to re-chunk and re-embed
- For move: update `source_path` on embeddings rows
- For delete: cascade delete embeddings

### 11. Context CLI Commands (`src/commands/context.ts`)

Replace stubs (these are in addition to the auto-generated tool CLI commands):

- `botholomew context add <path>` — ingest a file or directory from the real filesystem
  - Detect mime type from extension
  - For directories, walk and ingest each file
  - Show progress with spinner
- `botholomew context view <id>` — show context item details and its chunks
- `botholomew context remove <id>` — delete a context item and its embeddings

### 12. Daemon Integration (`src/daemon/llm.ts`)

Replace hand-written `DAEMON_TOOLS` and `executeToolCall`:
- `DAEMON_TOOLS` becomes `toAnthropicTools()` — auto-generated from registry
- `executeToolCall` dispatches via `getTool(name)` → validate input → `tool.execute()`
- Terminal tools (complete/fail/wait) detected via a `terminal` flag on the Tool class

### 13. CLI Integration (`src/commands/tools.ts`)

- `registerToolCommands(program)` — auto-generates Commander subcommands from tool registry
- Groups tools by `group` field → `dir`, `file`, `search` subcommand groups
- Derives positional args and `--options` from Zod schema shape
- Registered in `src/cli.ts`

### 14. Contextual Loading in System Prompt (`src/daemon/prompt.ts`)

Extend `buildSystemPrompt()`:
- Still load all `loading: always` markdown files
- When a task is provided, search context items relevant to the task name + description:
  1. Embed the task text
  2. Run `hybridSearch` with the embedding
  3. Include top-N results as additional context in the system prompt
- Also load `loading: contextual` markdown files if their content is keyword-relevant to the task

---

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Add `@xenova/transformers`, `zod`, `zod-to-json-schema` |
| `src/tools/tool.ts` | **New** — Tool base class, registry, adapters |
| `src/tools/task/*.ts` | **New** — 4 task tools (migrated from hand-written) |
| `src/tools/dir/*.ts` | **New** — 4 directory tools |
| `src/tools/file/*.ts` | **New** — 9 file tools |
| `src/tools/search/*.ts` | **New** — 3 search tools |
| `src/db/context.ts` | Full CRUD + filesystem query helpers |
| `src/db/embeddings.ts` | Full CRUD + search implementation |
| `src/db/schema.ts` | Improve `installVss()` fallback |
| `src/context/embedder.ts` | **New** — local embedding via transformers |
| `src/context/chunker.ts` | **New** — LLM-driven chunking |
| `src/context/ingest.ts` | **New** — full ingestion pipeline |
| `src/commands/context.ts` | CLI for ingest/view/remove |
| `src/commands/tools.ts` | **New** — auto-generate CLI from tool registry |
| `src/cli.ts` | Register tool commands |
| `src/daemon/prompt.ts` | Contextual loading for tasks |
| `src/daemon/llm.ts` | Replace hand-written tools with registry |

## Tests

- `test/tools/tool.test.ts` — base class, adapters
- `test/tools/dir/*.test.ts` — 1 test per tool
- `test/tools/file/*.test.ts` — 1 test per tool
- `test/tools/search/*.test.ts` — 1 test per tool
- `test/db/context.test.ts` — context CRUD + filesystem queries
- `test/db/embeddings.test.ts` — embedding CRUD, vector search
- `test/context/chunker.test.ts` — chunking strategies
- `test/context/ingest.test.ts` — full pipeline (mock LLM)

## Verification

1. `bun test` — all tests pass
2. Existing task tools still work after migration to Tool class
3. `botholomew file write /notes/meeting.md "# Meeting Notes"` — creates context item
4. `botholomew file read /notes/meeting.md` — prints content
5. `botholomew dir list /notes` — shows entries
6. `botholomew dir tree /` — shows virtual filesystem tree
7. `botholomew search grep "Meeting" --path /notes` — finds matches
8. `botholomew file edit /notes/meeting.md --patches '[{"start_line":1,"end_line":1,"content":"# Updated"}]'`
9. `botholomew context add ./some-folder` — ingests files, shows progress
10. `botholomew context search "quarterly revenue"` — returns ranked results with snippets
11. Daemon agent loop uses registered tools — no hand-written schemas
12. Daemon tick with a task — system prompt includes relevant context from DB
