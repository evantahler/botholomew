# The virtual filesystem

Botholomew's agent has no access to your real filesystem. When it calls
`file_read /notes/meeting.md`, there is no `/notes/meeting.md` on disk —
it's a row in the `context_items` table with `context_path =
'/notes/meeting.md'`.

This is deliberate:

- **Safety.** The agent can't touch anything outside the project.
- **Portability.** The entire "filesystem" is a single DuckDB file you
  can copy, share, or back up.
- **Searchability.** Every "file" is already indexed, chunked, embedded,
  and queryable.
- **History.** Everything the agent writes is recorded in
  `threads`/`interactions`, so you can audit every change.

---

## The mapping

| Filesystem concept | DuckDB representation |
|---|---|
| File path        | `context_items.context_path` (TEXT, unique) |
| File contents    | `context_items.content` (TEXT) or `content_blob` (BLOB) |
| MIME type        | `context_items.mime_type` |
| Directory        | A row with `mime_type = 'inode/directory'` |
| Directory listing | `SELECT DISTINCT parent(context_path) ...` |
| Binary file      | `is_textual = false`, content in `content_blob` |
| Source URL/path  | `source_path` (where the content originally came from) |
| Ingestion time   | `indexed_at`, `created_at`, `updated_at` |

---

## The agent's tools

These are the tools the agent sees. All are implemented as `ToolDefinition`
instances in `src/tools/dir/` and `src/tools/file/`.

**Directory operations:**

| Tool | What it does |
|---|---|
| `dir_create` | Create a directory placeholder row |
| `dir_list`   | List entries under a path (files + subdirs, with sizes) |
| `dir_tree`   | Render a markdown tree of everything under a prefix |
| `dir_size`   | Sum `length(content)` for items under a prefix |

**File operations:**

| Tool | What it does |
|---|---|
| `file_read`        | `getContextItemByPath(path)` → slice lines (`offset`/`limit`) |
| `file_write`       | Upsert a row, trigger re-chunk + re-embed |
| `file_edit`        | Apply git-style line-range patches |
| `file_delete`      | Remove by path (or recursively by prefix) |
| `file_copy`        | Duplicate a row with a new `context_path` |
| `file_move`        | Rename a row |
| `file_info`        | Return metadata (size, lines, mime, indexed_at) |
| `file_exists`      | Path existence check |
| `file_count_lines` | Count `\n` in content |

These are also exposed from the host CLI via Commander:

```bash
botholomew file write /notes/meeting.md "# Q4 Planning"
botholomew file read /notes/meeting.md
botholomew dir tree /
```

---

## Patch format for `file_edit`

```ts
{ start_line: number, end_line: number, content: string }
```

- `start_line` / `end_line` are 1-based inclusive.
- `end_line: 0` means **insert** without replacing.
- `content: ""` means **delete** the line range.
- Patches are applied bottom-up (descending `start_line`) so earlier
  line numbers remain stable.

Example — replace lines 5–7 and append at line 20:

```json
[
  { "start_line": 20, "end_line": 0,  "content": "\n## Appendix\n..." },
  { "start_line": 5,  "end_line": 7,  "content": "Updated text" }
]
```

---

## Embedding cascade

Every mutation cascades into the embeddings table:

- `file_write` → delete old chunks, re-chunk via LLM, re-embed, insert.
- `file_edit` → same.
- `file_move` → update `source_path` on embedding rows.
- `file_delete` → cascade delete embedding rows.

The HNSW index on `embeddings.embedding` stays in sync automatically (it
is maintained by DuckDB VSS on INSERT/DELETE, and persisted with
`SET hnsw_enable_experimental_persistence = true`).

---

## Why not just use files on disk?

A real filesystem would require:

- path escaping, sandboxing, symlink resolution;
- a separate indexer that must stay consistent with the files;
- backup/versioning/synchronization logic.

A DuckDB row is already all of those things at once — transactional,
searchable, and backed by a single file you can `cp` or `sqlite3` (well,
`duckdb`) into. The trade-off: you can't `cat` a note from the shell.
That's what `botholomew file read` is for.
