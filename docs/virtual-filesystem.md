# The virtual filesystem

Botholomew's agent has no access to your real filesystem. When it calls
`context_read /notes/meeting.md`, there is no `/notes/meeting.md` on disk —
it's a row in the `context_items` table with `context_path =
'/notes/meeting.md'`.

This is deliberate, and it's the single most important safety property
of the system:

- **Safety.** The agent cannot read your home directory, cannot
  overwrite your SSH keys, cannot `rm -rf` anything, cannot exfiltrate
  files it wasn't handed. A prompt-injected instruction telling it to
  "read `~/.ssh/id_rsa`" has nothing to act on — that path doesn't
  exist in its world. The worst a rogue agent can do is corrupt rows
  inside `.botholomew/data.duckdb`, which you can recover from a
  backup of a single file.
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
| `context_create_dir` | Create a directory placeholder row |
| `context_list_dir`   | List entries under a path (files + subdirs, with sizes) |
| `context_tree`       | Render a markdown tree of everything under a prefix — the agent's bird's-eye view for discovering what exists before reading or searching |
| `context_dir_size`   | Sum `length(content)` for items under a prefix |

**File operations:**

| Tool | What it does |
|---|---|
| `context_read`        | `getContextItemByPath(path)` → slice lines (`offset`/`limit`) |
| `context_write`       | Upsert a row, trigger re-chunk + re-embed, return a tree snapshot |
| `context_edit`        | Apply git-style line-range patches |
| `context_delete`      | Remove by path (or recursively by prefix) |
| `context_copy`        | Duplicate a row with a new `context_path` |
| `context_move`        | Rename a row |
| `context_info`        | Return metadata (size, lines, mime, indexed_at) |
| `context_exists`      | Path existence check |
| `context_count_lines` | Count `\n` in content |

These are also exposed from the host CLI via Commander:

```bash
botholomew context write /notes/meeting.md "# Q4 Planning"
botholomew context read /notes/meeting.md
botholomew context tree /
```

---

## Structured errors from `context_read` / `context_info`

When the agent passes a path that doesn't resolve, these tools return a
structured `is_error: true` response (they do **not** throw) so the model
can recover inside the same tool loop:

```json
{
  "is_error": true,
  "error_type": "not_found",
  "message": "No context item at /projects/foo/README.md",
  "next_action_hint": "Nearby paths under /projects/foo: /projects/foo/docs/a.md, /projects/foo/notes.md. Call context_tree({path:\"/projects/foo\"}) to see more."
}
```

On success, `context_info` returns the metadata under a `file` key:

```json
{
  "is_error": false,
  "file": {
    "id": "...", "title": "...", "context_path": "/projects/foo/notes.md",
    "mime_type": "text/markdown", "is_textual": true,
    "size": 1234, "lines": 42, ...
  }
}
```

The hint is built from `findNearbyContextPaths` — up to five immediate
siblings of the requested path's parent directory, walking up until it
finds a populated ancestor. `context_read` also returns
`error_type: "no_text_content"` when the target exists but is binary
(e.g. an image row).

CLI callers of the underlying resolver still throw — this shape is only
used by the agent-facing tools.

---

## Patch format for `context_edit`

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

- `context_write` → delete old chunks, re-chunk via LLM, re-embed, insert.
- `context_edit` → same.
- `context_move` → update `source_path` on embedding rows.
- `context_delete` → cascade delete embedding rows.

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
That's what `botholomew context read` is for.

And the biggest reason: **safety**. A filesystem abstraction that
happens to be a database is a filesystem the agent cannot escape.
There is no `..`, no symlink, no `/etc/passwd` — just a `context_path`
column with a `UNIQUE` constraint. If you're comfortable letting a
model make decisions on your behalf but not comfortable letting it
touch your disk, that's exactly the trade Botholomew makes.
