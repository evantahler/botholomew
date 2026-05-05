# Plan: Real On-Disk Project Layout (replace virtual FS in DuckDB)

## Context

Originally everything lived in DuckDB — `context_items`, `tasks`, `schedules`, `threads`, `interactions`, `workers`. That made the project opaque: no `vim`, no `grep`, no `git diff`.

We flipped every entity that's logically a record onto disk. The model now:

- **Project directory == cwd.** No `.botholomew/` wrapper. Top-level folders make the project's anatomy visible.
- **Agent-writable content** lives under `context/`.
- **Tasks** and **schedules** are markdown with strictly-validated frontmatter; workers claim them via `O_EXCL` lockfiles.
- **Threads + interactions** are CSV files at `context/threads/<YYYY-MM-DD>/<id>.csv` (one CSV per conversation, grouped by UTC creation date), so prior conversations are searchable through the same hybrid index everything else uses.
- **Workers** are JSON pidfiles at `workers/<id>.json`; the file is the registration record and `last_heartbeat_at` is the liveness signal (atomic-write-via-rename per heartbeat).
- **DuckDB** is now a **search-index sidecar**. The only tables left are `_migrations` and `context_index`.
- **Path-accepting tools** are sandboxed to the project root with strict traversal/symlink protection.

Pre-1.0 — **breaking change, no migration.** Users reinit.

## On-disk layout

```
<project-root>/
├── config/
│   └── config.json
├── prompts/        # was .botholomew/{soul,beliefs,goals,capabilities}.md
│   ├── soul.md
│   ├── beliefs.md
│   ├── goals.md
│   └── capabilities.md
├── skills/
│   └── *.md
├── mcpx/
│   └── servers.json
├── models/                    # embedding model cache
├── context/                   # agent-writable tree
│   ├── ... arbitrary tree ...
│   └── threads/               # one CSV per conversation, grouped by UTC date
│       └── <YYYY-MM-DD>/
│           └── <id>.csv       # 8-column CSV; first row = thread_meta JSON
├── tasks/                     # markdown w/ frontmatter
│   ├── <id>.md                # canonical; status in frontmatter
│   └── .locks/<id>.lock       # O_EXCL claim file (contains worker-id)
├── schedules/                 # markdown w/ frontmatter
│   ├── <id>.md
│   └── .locks/<id>.lock
├── workers/                   # one JSON pidfile per worker (heartbeats)
│   └── <id>.json
├── logs/                      # worker logs (stdout/stderr)
├── index.duckdb   # search index sidecar (rebuildable from disk)
└── .gitignore                 # written by init (empty new-folder section; user decides what to commit)
```

Project root discovery: **strict cwd / `--dir`** (no upward walker). Same as today.

## Sandboxing (the critical safety property)

Every tool that takes a `path` arg goes through one helper: `src/fs/sandbox.ts::resolveInRoot(root, userPath, opts)`.

Rules:
1. Reject NUL bytes; cap length at 4096.
2. Normalize to NFC (`userPath.normalize("NFC")`) — handles macOS NFD-after-vim cases.
3. `path.resolve(root, userPath)`; assert `=== root || startsWith(root + sep)`.
4. Reject `..` components after normalization (defense in depth).
5. **Component-by-component `lstat` walk** — reject any symlink at any level. (Plain `realpath`-after-the-fact has TOCTOU; lstat-walk is robust against the realistic threat: the agent accidentally writing through a symlink it created.) Hardlinks are out of scope (user's call).
6. `realpath` the project root **once at startup** and store the canonical path; all comparisons are against canonical root.
7. If `opts.area` is supplied, additionally enforce containment in `<root>/<area>/`. **Safelist, not blocklist** — most file/dir tools pin to `context/`. `models/`, `logs/`, `.locks/` are explicitly forbidden to tools.

Single helper, one caller pattern. One regression test per attack vector: `..`, absolute path, symlink at leaf, symlink at intermediate component, NUL byte, NFD↔NFC roundtrip, root-is-symlink, case-collision on case-insensitive fs, 4097-char path.

## Filesystem compatibility check

`fs.rename` and `O_EXCL` are unreliable on sync-overlay filesystems (iCloud, Dropbox, Google Drive, OneDrive) and NFS. At `init` and worker startup, detect via `statfs`/path heuristics. If detected, **error out unless `--force` is passed** (with a clear message naming the detected service).

## Tool surface

The 12 file/dir tools (`context_read`, `context_write`, `context_edit`, `context_copy`, `context_move`, `context_delete`, `context_exists`, `context_count_lines`, `context_info`, `context_create_dir`, `context_tree`, `context_dir_size`) keep their **names and behaviors**. Implementation changes:

- Drop the `drive` argument logically. **Backwards-compat**: accept the arg, ignore it (no warning needed since pre-1.0; just don't crash if a stale tool call arrives mid-thread).
- Path arg becomes a **project-relative path** (e.g., `notes/foo.md`), pinned to `context/` by the sandbox helper.
- Implementations switch from `src/db/context.ts` CRUD to `node:fs/promises`.
- `context_edit` (line-based patch) keeps its patch format: read → patch → atomic-write-via-rename.
- `context_info` uses `fs.stat`.

`update_beliefs` / `update_goals` / `capabilities_refresh` keep working — they already write real files; just update path constants.

## Tasks and schedules: lockfile-based claim

**Both tasks and schedules** use the same model:

- Canonical file: `tasks/<id>.md` or `schedules/<id>.md`.
- Lock file: `tasks/.locks/<id>.lock` or `schedules/.locks/<id>.lock`, created with `open(O_CREAT|O_EXCL|O_WRONLY)`. Body contains the worker-id (and `claimed_at`).
- **Claim**: `O_EXCL` open of the lock file. EEXIST → another worker holds it; try the next candidate.
- **Status updates** (incl. completing a task, updating `last_run_at` on a schedule): always **atomic-write-via-rename**:
  1. Read file, parse frontmatter.
  2. Validate the file's `mtime` matches what we read (re-read & abort on mismatch — handles user editing in vim mid-claim).
  3. Build new content with updated frontmatter.
  4. Write to `<id>.md.tmp.<wid>`.
  5. `fs.rename(tmp, <id>.md)` — single atomic commit.
- **Release**: `unlink(.locks/<id>.lock)`.
- **Reap** (`reapDeadWorkers`): walk `tasks/.locks/` and `schedules/.locks/`. For each lock whose worker-id is dead/missing in the workers table, `unlink` the lock. The next tick's claim attempt succeeds.

Why lockfiles for both (instead of move-based for tasks):
- **vim-safe**: vim's `:w` writes via atomic rename, changing the file's inode at its canonical path. Move-based claim would fight this; lockfiles don't.
- **git-friendly**: tasks/schedules stay in one folder, easy to review/diff.
- **One mental model** for two similar resources.

### Tasks frontmatter

```yaml
---
id: 0193abcd-...        # uuidv7
name: "Summarize PR #42"
priority: medium
status: pending          # pending | in_progress | complete | failed | waiting
blocked_by: []
context_paths: []        # was context_ids; now relative paths under context/
output: null             # filled on completion (null | string)
waiting_reason: null
created_at: 2026-05-02T10:00:00Z
updated_at: 2026-05-02T10:00:00Z
---

# Description

<markdown body>
```

Strict Zod validation in `src/tasks/schema.ts`. **Quarantine policy on validation failure**: log structured warning, skip the file (don't claim, don't count in DAG checks). Add CLI `bothy tasks doctor` to list malformed files. Don't auto-move to `malformed/` — user may want to fix in place.

### Schedules frontmatter

```yaml
---
id: ...
name: "Daily summary"
description: ...
frequency: "0 9 * * *"   # human-friendly; LLM evaluator decides if due
last_run_at: 2026-05-02T09:00:00Z
enabled: true
created_at: ...
updated_at: ...
---

# Body
<optional notes>
```

Schedule processing: lock → read → LLM-evaluate → create task files in `tasks/` → atomic-write-back schedule with new `last_run_at` → unlock. If user edited the file mid-process (mtime check fails), abort and retry next tick.

### DAG validation

Same logic; reads frontmatter from disk instead of rows. **In-process LRU cache** in `src/tasks/store.ts` keyed by `(path, mtime)` — keeps DAG cycle checks microsecond-fast at 10k tasks. Build only when profiling shows it's needed; v1 can ship with naive walks.

### Predecessor outputs

Successor reads `blocked_by` IDs, looks up the corresponding `tasks/<id>.md`, parses frontmatter `status` + `output`. Same surface as today.

## Threads + interactions: CSV files under context/threads/

Conversation history (worker ticks and chat sessions) is stored as one CSV file per thread at `context/threads/<YYYY-MM-DD>/<id>.csv`. Files are grouped under the UTC date the thread was created on so the directory stays browsable as conversations accumulate. UTC (not local time) keeps the path stable across machines and timezone moves.

The thread id is a uuidv7 — the first 48 bits are a unix-millis timestamp — so the date subdir is a pure function of the id: writes know where to go, reads predict the path without scanning. For non-v7 ids (legacy or hand-written), reads fall back to walking the date subdirs.

The placement under `context/` is deliberate: the regular `context reindex` walks them, so prior conversations are searchable through the same hybrid index everything else uses.

CSV schema (8 columns, RFC-4180 quoted):

```
created_at,role,kind,content,tool_name,tool_input,duration_ms,token_count
```

Thread metadata (title, source_type, parent_task_id, started_at) is encoded as a synthetic first row with `kind="thread_meta"` whose `content` is a JSON blob. End-of-thread is a `kind="thread_ended"` row. The format stays pure CSV — no sidecar files, no frontmatter — at the cost of a full file rewrite when the title changes (cheap, threads are small).

Append is the hot path: `logInteraction` opens the file in 'a' mode and writes one row. Each thread is owned by exactly one writer at a time (the chat session or the worker tick that owns the thread), so we don't need lockfiles around interaction appends.

CRUD lives in `src/threads/store.ts`:
- `createThread`, `logInteraction`, `endThread`, `reopenThread`
- `getThread` returns `{ thread, interactions[] }` parsed from the CSV
- `listThreads` walks `context/threads/`, parses each file's `thread_meta`
- `updateThreadTitle` rewrites the meta row in place
- `getInteractionsAfter(threadId, sequence)` for follow-mode (TUI thread panel)

## Workers: JSON pidfiles under workers/

Each worker has one canonical record at `workers/<id>.json`. The file's existence is the pidfile; `last_heartbeat_at` inside is the liveness signal. Heartbeats atomically rewrite the file (write-to-tmp + rename). Reaper:

1. Walk `workers/`, parse each JSON.
2. For any running worker whose `last_heartbeat_at` is older than `staleAfterSeconds`, rewrite with `status="dead"`.
3. Then walk `tasks/.locks/` and `schedules/.locks/`; for each lock whose holder isn't running per the worker JSON, `unlink` the lock so the next tick can re-claim.
4. Optionally prune cleanly-stopped workers older than the retention window. Dead workers are kept as forensic evidence.

CRUD lives in `src/workers/store.ts`:
- `registerWorker`, `heartbeat`, `markWorkerStopped`, `markWorkerDead`
- `reapDeadWorkers`, `pruneStoppedWorkers`, `isWorkerRunning`
- `listWorkers`, `getWorker`, `deleteWorker`

## Search index

`index.duckdb` keeps the existing `embeddings` table + FTS index. Schema simplified: `(path, chunk_index, chunk_content, title, embedding, content_hash, mtime, size)`. **`title`/heading kept** — it's load-bearing for search ranking.

Lifecycle:
- Every write/edit/delete tool, after committing the disk change, calls `reindexPath(path)`: deletes existing rows for that path, re-chunks, re-embeds, inserts, calls `rebuildSearchIndex()`.
- New CLI: `botholomew reindex` — walks `context/`, diffs against the index using **content hash** (sha256 from `node:crypto`); mtime+size alone misses same-length edits with preserved mtime.
- New CLI: `botholomew reindex --full` — drops the DB and rebuilds from scratch.
- **Worker tick adds a 30s background reindex pass** so external `vim` edits get picked up without manual command.
- **DuckDB single-writer**: in-process reindex only. The `bothy reindex` CLI acquires a file lock; refuses if a worker is running.

If the index DB is missing, recreate empty on next start; first reindex populates.

## Critical files to change

**New:**
- `src/fs/{sandbox,atomic,compat}.ts` — path resolver, atomic write + lockfiles, iCloud/Dropbox detector.
- `src/context/store.ts` — disk-backed context CRUD (replaces `src/db/context.ts`).
- `src/tasks/{schema,store}.ts` — Zod-validated frontmatter, lockfile claim.
- `src/schedules/{schema,store}.ts` — same shape, with min-interval guard.
- `src/threads/store.ts` — CSV-based threads + interactions under `context/threads/`.
- `src/workers/store.ts` — JSON pidfiles under `workers/`, atomic-rewrite heartbeats.
- `src/context/reindex.ts` — walk + hash + chunk + embed sync algorithm.
- `src/commands/context.ts` — `bothy context` CLI: import / reindex / tree / stats.
- `src/db/sql/19-disk_backed_index.sql` + `20-drop_db_tables_for_files.sql` — drop retired tables, create `context_index`.

**Deleted:**
- `src/db/{context,tasks,schedules,threads,workers,daemon-state,reembed}.ts`
- `src/context/{ingest,refresh,describer,drives}.ts` (search/ingest pipeline rebuilt from scratch around path-keyed `context_index`).
- `src/commands/tools.ts` (was the old context-tools-as-CLI bridge).

**Major rewrites:**
- All 12 `src/tools/file/*` and `src/tools/dir/*` tools → use `src/context/store.ts`; `drive` arg gone.
- `src/tools/{thread,task,schedule}/*` and `src/tools/search/*` → use the new file-based stores.
- `src/worker/{tick,schedules,heartbeat,index,llm}.ts` → claim via lockfiles, register in JSON, log interactions to CSV.
- `src/chat/{session,agent}.ts`, `src/utils/title.ts` → write threads to CSV.
- `src/tui/components/{StatusBar,WorkerPanel,ThreadPanel,ContextPanel,TaskPanel,SchedulePanel}.tsx` → all read disk stores.
- `src/init/index.ts`, `src/constants.ts` — write the new tree; refuse incompatible filesystems unless `--force`.
- `src/db/schema.ts` + SQL migrations — only `_migrations` and `context_index` survive.

**Documentation** (each listed in CLAUDE.md):
- `docs/virtual-filesystem.md` → rename to `docs/files.md` (or `docs/context.md`); rewrite for real disk + sandbox.
- `docs/architecture.md` — connection model, claim model.
- `docs/tasks-and-schedules.md` — lockfile claim, frontmatter schema.
- `docs/context-and-search.md` — reindex flow, hash-based drift detection.
- `docs/configuration.md` — new layout.
- `docs/prompts.md` — path is now `prompts/`.
- `docs/skills.md`, `docs/mcpx.md`, `docs/tui.md` — path updates.
- `README.md` — CLI table, layout description.
- New `CHANGELOG.md` entry — breaking change.

## Phasing — what actually shipped

This was scoped as 5 PRs but landed as a single mega-branch (`evantahler/real-fs-project-layout`) because the entities are tightly coupled. The branch accumulated through these passes:

1. FS primitives (sandbox, atomic, compat) + new init layout + constants reorg.
2. Tasks- and schedules-as-files with lockfile claim. Worker tick + reaper updated.
3. Context store + 12 file/dir tool rewrites.
4. Search restored: regexp + semantic search tool over disk; `pipe_to_context` rebuilt.
5. `bothy context` CLI (import / reindex / tree / stats) + path-keyed `context_index` table.
6. Threads + interactions → CSV under `context/threads/`. Workers → JSON pidfiles under `workers/`. Migration 20 drops the last DB tables.

After all of this the only DuckDB tables remaining are `_migrations` and `context_index`.

## Verification

End-to-end smoke (Phase 4 complete):

1. `bun run build && rm -rf /tmp/proj && mkdir /tmp/proj && cd /tmp/proj && bothy init`.
2. Verify the new tree exists; no `.botholomew/` directory; index DB present.
3. `bothy chat`: `context_write notes/test.md "hello"` → confirm `/tmp/proj/context/notes/test.md`.
4. **Traversal attack**: `context_write ../escape.md "x"` → must error.
5. **Symlink attack**: `ln -s /etc/passwd context/link.txt && context_read link.txt` → must error.
6. Create a task via CLI → `tasks/<id>.md` exists with `status: pending`.
7. Run a worker → `tasks/.locks/<id>.lock` appears; on completion the lock disappears and `tasks/<id>.md` frontmatter shows `status: complete` with output.
8. **Race**: spawn two workers, one task pending → exactly one wins.
9. **Crash**: SIGKILL a worker mid-task → reaper unlinks the orphaned lock; another worker re-claims.
10. **vim race**: edit `tasks/<id>.md` in vim while a worker is claimed; on `:w` the worker's mtime check fails, it aborts cleanly and retries next tick.
11. `vim context/notes/test.md`, save → within 30s the background reindex picks it up (or `bothy reindex` finds it via content hash).
12. `rm index.duckdb && bothy reindex --full` → search still works.
13. **Filesystem compat**: cd into `~/Library/Mobile Documents/...` and run `bothy init` → refuses; `--force` works with warning.

Tests landed:
- `test/tools/search.test.ts` (regexp side, scope, glob, traversal rejection).
- `test/tools/pipe.test.ts` (capture, inner-tool error, terminal-tool rejection, conflict + overwrite).
- `test/context/reindex.test.ts` (add / update / unchanged / removed / binary-skip with injectable embedder).
- `test/threads/store.test.ts` (CSV escaping, append, end/reopen, title rewrite, list filters, malformed quarantine).
- `test/workers/store.test.ts` (heartbeat, reap stale, prune stopped, status filters, delete).
- `test/db/schema.test.ts` asserts only `_migrations` + `context_index` survive.

`bun test && bun run lint` must pass.
