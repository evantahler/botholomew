# The knowledge store

Botholomew's agent has no access to your real filesystem. Its world is the
[`membot`](https://github.com/evantahler/membot) knowledge store backing this
project — a single DuckDB file at `<projectDir>/index.duckdb`, addressed by
`logical_path` (an opaque string key, not a filesystem path). Every read,
write, search, and delete the agent makes goes through the `membot_*` tools.

The safety properties this gives you:

- **No filesystem access.** A prompt-injected instruction to "read
  `~/.ssh/id_rsa`" fails because there is no tool that takes a host-filesystem
  path. The agent can only address entries already in the store.
- **Versioned.** Every `membot_write` / `membot_edit` creates a new
  `version_id`. Deletes are tombstones, not unlinks. Use `membot_versions`
  to inspect history, `membot_diff` to compare two snapshots, and
  `botholomew context prune` to permanently drop old versions when you want
  to.
- **Auditable.** The DB is local, plain DuckDB, and your data lives in tables
  you can query directly with the DuckDB CLI if you ever want to.

The store itself is owned by membot — including the ingestion pipeline
(PDF/DOCX/HTML → markdown, local WASM embeddings, hybrid BM25 + semantic
search), URL refresh, and append-only versioning. This page documents the
Botholomew-side surface: the agent tools, the line-patch edit shape, and the
CLI passthrough.

## Agent tools

Each `membot_*` tool wraps one membot operation. Names mirror upstream membot
exactly so reading membot's docs gives you the same vocabulary the agent uses.

| Tool | Purpose |
|---|---|
| `membot_add` | Ingest a local file, directory, glob, URL, or `inline:<text>` literal. |
| `membot_list` | List current entries (one row per `logical_path`). |
| `membot_tree` | Render the path tree synthesized from `/` segments in `logical_path`. |
| `membot_read` | Read the current (or a historical) version of an entry. |
| `membot_search` | Hybrid semantic + BM25 search with RRF fusion. |
| `membot_info` | Inspect metadata (source, mime, sha256s, refresh status) for one entry. |
| `membot_stats` | Counts and storage summary for the whole store. |
| `membot_versions` | List every version of an entry (newest first). |
| `membot_diff` | Unified diff between two versions of an entry. |
| `membot_write` | Write inline content as a new version. Whole-file replace. |
| `membot_move` | Rename a `logical_path` (creates a new version, tombstones the old). |
| `membot_delete` | Tombstone one or more entries. Use `membot_prune` to GC. |
| `membot_refresh` | Re-fetch a URL-backed entry (if its source supports refresh). |
| `membot_prune` | Permanently drop history older than a cutoff. |

Botholomew adds five wrappers on top so the agent can use the file-shaped
idioms it already knows:

| Wrapper | Behavior |
|---|---|
| `membot_edit` | `read` → apply git-hunk line patches → `write`. Same `LinePatchSchema` as `task_edit`, `schedule_edit`, `prompt_edit`. |
| `membot_copy` | `read` → `write` under a new `logical_path`. The source is untouched (use `membot_move` if you want to rename). |
| `membot_exists` | `info` + catch `not_found`. Returns `{ exists: true \| false }` — never throws. |
| `membot_count_lines` | `wc -l` over the markdown surrogate. Useful before a paginated read. |
| `membot_pipe` | Run another tool and write its output as a new membot entry without ever flowing the body through the conversation. |

## The patch format

`membot_edit` uses the shared `LinePatchSchema` from `src/fs/patches.ts`:

```ts
{
  start_line: number,  // 1-based, inclusive
  end_line: number,    // 1-based, inclusive; 0 = insert without replacing
  content: string      // empty string deletes
}
```

Patches are applied bottom-up so earlier line numbers stay stable across a
multi-hunk edit. The same shape powers `task_edit`, `schedule_edit`,
`prompt_edit`, and `skill_edit` — one mental model across every resource the
agent can mutate in place.

## CLI passthrough

`botholomew context <verb> …` spawns `membot <verb> … --config <projectDir>`
and forwards stdio. Run `botholomew context --help` for the verb list.

```bash
botholomew context add ./docs/howto.md
botholomew context add https://docs.google.com/document/d/...
botholomew context search "how does the worker tick claim tasks?"
botholomew context ls
botholomew context tree
botholomew context read docs/howto.md
botholomew context versions docs/howto.md
botholomew context diff docs/howto.md v1 v2
```

The Botholomew-specific helper is:

```bash
botholomew context import-global
```

It copies `~/.membot/index.duckdb` and `~/.membot/config.json` into the
project so you can seed a new project with whatever you've built up in your
personal membot. Refuses to overwrite a non-empty project store unless you
pass `--force`.

## Where Botholomew still uses real files

Knowledge is the only thing that moved into membot. These still live as real
files under `<projectDir>/`:

- `tasks/<id>.md`, `schedules/<id>.md` — markdown + strict frontmatter, with
  `O_EXCL` lockfiles for worker claim
- `threads/<YYYY-MM-DD>/<id>.csv` — RFC-4180 conversation logs
- `workers/<id>.json` — pidfile + heartbeat per worker
- `prompts/*.md` — agent's persistent context (goals, beliefs, capabilities,
  and any you add)
- `skills/*.md` — slash-command skills
- `logs/<YYYY-MM-DD>/<workerId>.log` — worker stdout/stderr
- `config/config.json`, `mcpx/servers.json` — settings

All of those still route through `src/fs/sandbox.ts::resolveInRoot` for path
safety (NFC normalize, reject `..` / NUL / absolute paths, lstat-walk every
component) — that helper is general, not specific to knowledge content.
