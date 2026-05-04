# Plan: Real On-Disk Project Layout (replace virtual FS in DuckDB)

## Context

Today, agent-writable files live in DuckDB (`context_items` table); tasks and schedules live in `tasks` / `schedules` rows. This makes the project opaque to the user — they can't `vim`, `grep`, or `git diff` their work.

We're flipping the model:

- **Project directory == cwd.** No more `.botholomew/` wrapper. Top-level folders make the project's anatomy visible.
- **Agent-writable content** lives in real files under `context/`.
- **Tasks and schedules** become markdown with strictly-validated frontmatter.
- **DuckDB** demoted to a **search-index sidecar** — fully derivable from disk, blowable away.
- **Worker claims** use lockfiles (`O_EXCL`) for both tasks and schedules; status lives in frontmatter; files stay in one canonical location.
- **Path-accepting tools** are sandboxed to the project root with strict traversal/symlink protection.

Pre-1.0 — **breaking change, no migration.** Users reinit.

## On-disk layout

```
<project-root>/
├── config/
│   └── config.json
├── persistent-context/        # was .botholomew/{soul,beliefs,goals,capabilities}.md
│   ├── soul.md
│   ├── beliefs.md
│   ├── goals.md
│   └── capabilities.md
├── skills/
│   └── *.md
├── mcpx/
│   └── servers.json
├── models/                    # embedding model cache
├── context/                   # NEW — agent-writable tree (was DuckDB context_items)
│   └── ... arbitrary tree ...
├── tasks/                     # NEW — markdown w/ frontmatter
│   ├── <id>.md                # canonical; status in frontmatter
│   └── .locks/<id>.lock       # O_EXCL claim file (contains worker-id)
├── schedules/                 # NEW — markdown w/ frontmatter
│   ├── <id>.md
│   └── .locks/<id>.lock
├── logs/                      # worker logs
├── .botholomew-index.duckdb   # search index sidecar (rebuildable)
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

## Search index

`.botholomew-index.duckdb` keeps the existing `embeddings` table + FTS index. Schema simplified: `(path, chunk_index, chunk_content, title, embedding, content_hash, mtime, size)`. **`title`/heading kept** — it's load-bearing for search ranking.

Lifecycle:
- Every write/edit/delete tool, after committing the disk change, calls `reindexPath(path)`: deletes existing rows for that path, re-chunks, re-embeds, inserts, calls `rebuildSearchIndex()`.
- New CLI: `botholomew reindex` — walks `context/`, diffs against the index using **content hash** (sha256 from `node:crypto`); mtime+size alone misses same-length edits with preserved mtime.
- New CLI: `botholomew reindex --full` — drops the DB and rebuilds from scratch.
- **Worker tick adds a 30s background reindex pass** so external `vim` edits get picked up without manual command.
- **DuckDB single-writer**: in-process reindex only. The `bothy reindex` CLI acquires a file lock; refuses if a worker is running.

If the index DB is missing, recreate empty on next start; first reindex populates.

## Critical files to change

**New:**
- `src/fs/sandbox.ts` — `resolveInRoot()` (path validator/resolver).
- `src/fs/atomic.ts` — `atomicWrite()`, `acquireLock()`, `releaseLock()`, `withLock()`.
- `src/fs/compat.ts` — unsupported-filesystem detector.
- `src/tasks/{schema,store,claim}.ts` — Zod schema, file CRUD, lock-based claim.
- `src/schedules/{schema,store,claim}.ts` — same shape.
- `src/context/store.ts` — disk-backed context CRUD (replaces `src/db/context.ts`).
- `src/commands/reindex.ts` — `bothy reindex [--full]`.
- `src/commands/tasks-doctor.ts` — list malformed task/schedule files.

**Major rewrites:**
- `src/tools/file/*.ts` (9 tools), `src/tools/dir/*.ts` (3 tools) — switch to `src/context/store.ts`; drop/ignore `drive` arg.
- `src/db/tasks.ts`, `src/db/schedules.ts` — delete; replace callers.
- `src/db/workers.ts` — `reapDeadWorkers` now walks `tasks/.locks/` and `schedules/.locks/` instead of releasing DB claims.
- `src/worker/tick.ts`, `src/worker/schedules.ts` — claim via lockfiles.
- `src/init/index.ts`, `src/init/templates.ts` — write the new tree; refuse incompatible filesystems unless `--force`.
- `src/constants.ts` — drop `BOTHOLOMEW_DIR`; add area constants (`CONTEXT_DIR`, `TASKS_DIR`, `SCHEDULES_DIR`, etc.) and `INDEX_DB_FILENAME`.
- `src/db/schema.ts` + `src/db/sql/*.sql` — drop `context_items`, `tasks`, `schedules` tables; embeddings table reduced to `(path, chunk_index, chunk_content, title, embedding, content_hash, mtime, size)`.
- `src/context/ingest.ts` — write to `context/` first, then index.
- `src/db/connection.ts` — index DB path is now `<root>/.botholomew-index.duckdb`.

**Documentation** (each listed in CLAUDE.md):
- `docs/virtual-filesystem.md` → rename to `docs/files.md` (or `docs/context.md`); rewrite for real disk + sandbox.
- `docs/architecture.md` — connection model, claim model.
- `docs/tasks-and-schedules.md` — lockfile claim, frontmatter schema.
- `docs/context-and-search.md` — reindex flow, hash-based drift detection.
- `docs/configuration.md` — new layout.
- `docs/persistent-context.md` — path is now `persistent-context/`.
- `docs/skills.md`, `docs/mcpx.md`, `docs/tui.md` — path updates.
- `README.md` — CLI table, layout description.
- New `CHANGELOG.md` entry — breaking change.

## Phasing (5 PRs)

1. **PR-1**: FS detector + sandbox helper + new init layout + constants reorg. Move skills, persistent-context, config, mcpx to top-level. (Sandbox has a real caller from day one.)
2. **PR-2**: Tasks-as-files. Lockfile claim. Worker tick + reaper updated.
3. **PR-3**: Schedules-as-files. Same model.
4. **PR-4**: Context store + 12 file/dir tools + `bothy reindex` + 30s background reindex pass. Embeddings schema simplified.
5. **PR-5**: Docs sweep + CHANGELOG.

Each PR ships green tests and a working CLI.

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
12. `rm .botholomew-index.duckdb && bothy reindex --full` → search still works.
13. **Filesystem compat**: cd into `~/Library/Mobile Documents/...` and run `bothy init` → refuses; `--force` works with warning.

Tests:
- New: `test/fs/sandbox.test.ts` (every attack vector incl. NFC/NFD), `test/fs/atomic.test.ts` (lock contention, atomic write, mtime conflict), `test/tasks/claim-race.test.ts` (multi-worker), `test/schedules/claim.test.ts`, `test/fs/compat.test.ts`.
- Port: `test/tools/file/*`, `test/tools/dir/*` to use `setupProjectDir()` (new helper) instead of `setupTestDb()`.
- Update/delete: `test/db/tasks-claim-race.test.ts`, `test/db/schedules-claim.test.ts` — rewrite against fs.

`bun test && bun run lint` must pass.
