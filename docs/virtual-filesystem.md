# The virtual filesystem

Botholomew's agent has no access to your real filesystem. Every piece of
content the agent can touch lives in the `context_items` table as a row
identified by a `(drive, path)` pair. When the agent calls
`context_read({ drive: "disk", path: "/Users/evan/notes/meeting.md" })`,
it is **not** opening that file on disk — it's reading the row that was
ingested from it.

This is deliberate, and it's the single most important safety property
of the system:

- **Safety.** The agent cannot read your home directory, cannot
  overwrite your SSH keys, cannot `rm -rf` anything, cannot exfiltrate
  files it wasn't handed. A prompt-injected instruction telling it to
  "read `~/.ssh/id_rsa`" has nothing to act on — that path doesn't
  exist in its world unless you ingested it. The worst a rogue agent
  can do is corrupt rows inside `.botholomew/data.duckdb`, which you
  can recover from a backup of a single file.
- **Portability.** The entire "filesystem" is a single DuckDB file you
  can copy, share, or back up.
- **Searchability.** Every "file" is already indexed, chunked, embedded,
  and queryable.
- **History.** Everything the agent writes is recorded in
  `threads`/`interactions`, so you can audit every change.

---

## Drives

Every context item lives under a **drive**. The drive names the origin
of the content; the path is whatever that origin natively uses.

| Drive | Path shape | Example ref |
|---|---|---|
| `disk` | absolute filesystem path | `disk:/Users/evan/notes/meeting.md` |
| `url` | full URL (with scheme) | `url:/https://example.com/post` |
| `agent` | arbitrary agent-chosen path | `agent:/notes/scratch.md` |
| `google-docs` | Google Docs document id | `google-docs:/1AbCDEFGhij` |
| `github` | `/<owner>/<repo>/<rest>` | `github:/evantahler/botholomew/README.md` |

The `drive:/path` string form is the display and CLI convention.
Internally, `context_items` has two columns — `drive TEXT` and
`path TEXT` — with a `UNIQUE(drive, path)` index. That index is the
identity key: an ingest that hits an existing `(drive, path)` is a
refresh, never a duplicate.

New drives (additional MCP services) can be added by teaching
`src/context/drives.ts:detectDriveFromUrl` to recognize their URLs
and extract the right path shape.

### The `agent` drive

Content written by the agent itself (via `context_write`) defaults to
the `agent` drive. It has no external origin, so it's never a candidate
for `context_refresh`.

---

## The mapping

| Filesystem concept | DuckDB representation |
|---|---|
| Identity            | `(context_items.drive, context_items.path)` — unique together |
| Display form        | `drive:/path` (e.g. `disk:/Users/x/foo.md`) |
| File contents       | `context_items.content` (TEXT) or `content_blob` (BLOB) |
| MIME type           | `context_items.mime_type` |
| Directory           | A row with `mime_type = 'inode/directory'` |
| Directory listing   | Items filtered by `drive` and a path prefix, with intermediate directory segments derived from the matching paths |
| Binary file         | `is_textual = false`, content in `content_blob` |
| Ingestion time      | `indexed_at`, `created_at`, `updated_at` |

---

## The agent's tools

All tools that operate on context items take `(drive, path)` together.
For `context_read`, `context_info`, and `context_exists`, `path` can
also be a bare UUID or a `drive:/path` string — in those cases `drive`
is ignored.

**Discovery:**

| Tool | What it does |
|---|---|
| `context_list_drives` | List every drive that has content, with counts — a good first call when you don't know what's ingested |
| `context_tree`        | With no `drive`: list drives. With a drive: render a tree of that drive — the agent's bird's-eye view |

**Directory operations:**

| Tool | What it does |
|---|---|
| `context_create_dir` | Create a directory placeholder row (defaults to `drive: "agent"`) |
| `context_dir_size`   | Sum `length(content)` for items under a drive/prefix |

**File operations:**

| Tool | What it does |
|---|---|
| `context_read`        | Read an item's content; slice by line (`offset`/`limit`) |
| `context_write`       | Upsert a row, trigger re-chunk + re-embed, return a tree snapshot (defaults to `drive: "agent"`) |
| `context_edit`        | Apply git-style line-range patches |
| `context_delete`      | Remove by (drive, path) or recursively by prefix |
| `context_copy`        | Duplicate a row to a new (drive, path) |
| `context_move`        | Rename or relocate a row — can move between drives |
| `context_info`        | Return metadata (size, lines, mime, indexed_at, drive, path, ref) |
| `context_exists`      | (drive, path) existence check |
| `context_count_lines` | Count `\n` in content |

These are also exposed from the host CLI:

```bash
botholomew context add ~/notes/meeting.md        # ingests as disk:/Users/.../meeting.md
botholomew context add https://github.com/evantahler/botholomew/blob/main/README.md
                                                 # ingests as github:/evantahler/botholomew/README.md
botholomew context list
botholomew context read disk:/Users/evan/notes/meeting.md
botholomew context tree disk:/Users/evan/notes
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
  "message": "No context item at disk:/Users/evan/notes/architecture.md",
  "next_action_hint": "Nearby items under disk:/Users/evan/notes: disk:/Users/evan/notes/readme.md, disk:/Users/evan/notes/guide.md. Call context_tree({drive:\"disk\",path:\"/Users/evan/notes\"}) to see more."
}
```

The hint is built from `findNearbyContextPaths` — up to five siblings
of the requested path's parent directory within the same drive, walking
up until it finds a populated ancestor. `context_read` also returns
`error_type: "no_text_content"` when the target exists but is binary
(e.g. an image row).

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

---

## Embedding cascade

Every mutation cascades into the embeddings table:

- `context_write` → delete old chunks, re-chunk, re-embed, insert.
- `context_edit` → same.
- `context_move` → no embedding changes (embeddings reference the item id, not the path).
- `context_delete` → cascade delete embedding rows.

Embeddings are stored as `FLOAT[1536]` and queried by linear scan via
`array_cosine_distance()` — no HNSW index, no VSS extension. The FTS
index over `chunk_content` and `title` is rebuilt by
`rebuildSearchIndex()` after every ingest write. See
[context-and-search.md](context-and-search.md) for the full pipeline.

---

## Why not just use files on disk?

A real filesystem would require:

- path escaping, sandboxing, symlink resolution;
- a separate indexer that must stay consistent with the files;
- backup/versioning/synchronization logic.

A DuckDB row is already all of those things at once — transactional,
searchable, and backed by a single file you can `cp` or `sqlite3` (well,
`duckdb`) into.

And the biggest reason: **safety**. A filesystem abstraction that
happens to be a database is a filesystem the agent cannot escape.
There is no `..`, no symlink, no `/etc/passwd` — just `(drive, path)`
columns with a `UNIQUE` constraint. If you're comfortable letting a
model make decisions on your behalf but not comfortable letting it
touch your disk, that's exactly the trade Botholomew makes.
