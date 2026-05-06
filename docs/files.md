# Files & the sandbox

Botholomew's agent has no access to your real filesystem. Its world is
the `context/` tree inside the project directory — real markdown and
text files, but reachable only through a sandbox helper that rejects
anything pointing outside.

This is deliberate, and it's the single most important safety property
of the system:

- **Safety.** The agent cannot read your home directory, cannot
  overwrite your SSH keys, cannot `rm -rf` anything, cannot exfiltrate
  files it wasn't handed. A prompt-injected instruction telling it to
  "read `~/.ssh/id_rsa`" fails before any IO happens. The worst a
  rogue agent can do is scribble inside `context/`, which `git diff`
  will catch and `git checkout -- context/` will undo. (You *can*
  symlink external content into `context/` yourself — see below — and
  the agent can read those, but it can never *write through* them.)
- **Inspectability.** Every file the agent reads or writes is a real
  file. `vim`, `grep`, `git diff`, `cat`, and `less` all work. Drop a
  hand-written note into `context/` and the agent finds it on the next
  search.
- **Searchability.** Every write triggers a per-path reindex into
  `index.duckdb` (the search-index sidecar over `context/`), so the
  agent's `context_search` finds new content within milliseconds. The
  index is fully derivable — `botholomew context reindex --full`
  rebuilds it from disk.
- **History.** Every write the agent does is recorded in the
  conversation thread (`threads/<date>/<id>.csv`), so you can audit
  every change.

---

## Where the agent's files live

Everything under `<project-root>/context/` is part of the agent's
world. The agent always uses **project-relative forward-slash paths**:

```
context_read({ path: "notes/meeting.md" })
context_write({ path: "research/2026-q1.md", content: "..." })
context_tree({ path: "notes" })
```

Absolute paths, leading `..`, NUL bytes, and paths over 4096 chars are
rejected. The sandbox does NFC normalization (so vim's NFD-on-macOS
roundtrips cleanly) and `lstat`-walks every path component, refusing
the call if any segment is a symlink — **unless** the caller passes
`allowSymlinks: true`. Read-side ops (`context_read`, `context_tree`,
`context_info`, search, reindex) opt in so users can drop symlinks
into `context/` for content they don't want to duplicate; mutating ops
(`context_write`, `context_edit`, `context_move`, `context_copy`,
`context_create_dir`) keep the strict resolver, so the agent can never
write through a user-placed symlink to external content.

The path validator lives in `src/fs/sandbox.ts::resolveInRoot`. There
is exactly one helper, used by every path-taking tool.

---

## Safelisted areas

The sandbox is a safelist. By default tools pin to `<root>/context/`.
Off-limits to the agent:

- `models/` — embedding model cache; rewriting it would corrupt search
- `logs/` — worker logs (system metadata, not knowledge)
- `tasks/.locks/`, `schedules/.locks/` — claim files; the agent should
  never poke at lockfiles directly
- `index.duckdb` — derived state; rebuild via `context reindex` if it
  goes wrong
- Everything outside the project root, full stop

Tasks/schedules/threads/prompts/skills are also outside `context/` —
the agent edits prompts via `prompt_read`/`prompt_edit`, edits skills
via `skill_edit`, edits tasks via `task_edit` (pending-only) or
`update_task` (typed field updater), edits schedules via
`schedule_edit`, and reads threads through `view_thread` /
`search_threads`. Every edit tool — `context_edit`, `skill_edit`,
`schedule_edit`, `task_edit`, `prompt_edit` — uses the same
[git-hunk patch format](#patch-format) so the agent learns one shape.
Files-on-disk all the way down, but each area has the right tool
surface for its shape.

---

## Filesystem compatibility

`fs.rename` and `O_EXCL` are unreliable on sync-overlay filesystems
(iCloud, Dropbox, Google Drive, OneDrive) and NFS — the files appear
to write, but the atomicity guarantee that tasks/schedules and
context-edit need quietly doesn't hold. `botholomew init` and worker
startup detect these via path heuristics and refuse to run there
unless `--force` is passed.

If you need a project on a synced volume, run `botholomew init` on a
local path and copy/symlink the synced bits in by hand — but
understand you're trading away the atomicity guarantee.

---

## User-placed symlinks under `context/`

You can drop symlinks into `context/` to share content the agent should
read but you don't want to duplicate. For example:

```bash
ln -s "$HOME/Documents/research" context/research
ln -s "$HOME/notes/standup.md" context/standup.md
```

Both forms work — file symlinks and directory symlinks. The contract:

- **Read, list, tree, search, index**: follow the link transparently. A
  symlinked directory's contents are walked and indexed as if they
  lived under `context/` directly. Cycles (`context/loop -> context/`)
  are detected via a `dev:ino` visited set and walked at most once;
  recursion is also capped at 32 levels.
- **`context_info` / listings**: surface `is_symlink: true` so the
  agent knows the entry is a reference.
- **`context_delete`**: removes only the symlink itself. The target
  file or directory is never touched. `recursive: true` is not required
  for a symlinked directory — the link unlinks atomically. The leaf
  must be the symlink: `context_delete linked/file.md` (where
  `linked` is a user-placed symlink) is rejected with `PathEscapeError`,
  the same as `context_move` / `context_copy` already do, so the agent
  can't reach external content via a symlinked parent directory.
- **`context_write`, `context_edit`, `context_move`, `context_copy`,
  `context_create_dir`**: refuse any path that traverses a symlink and
  return `PathEscapeError`. This is what makes the "external content
  is never modified" guarantee real. The recovery hint suggests
  deleting the symlink first or writing to a real path.

The agent itself cannot create symlinks — there is no tool for it. So
"symlinks under `context/`" always means *user-placed* symlinks.

---

## The agent's file/dir tools

All paths are project-relative under `context/`.

**Discovery:**

| Tool | What it does |
|---|---|
| `context_tree`        | List the tree at a path; the agent's bird's-eye view of `context/` |
| `context_dir_size`    | Sum the byte size of files under a directory |

**Directory operations:**

| Tool | What it does |
|---|---|
| `context_create_dir` | Create a directory (intermediate dirs created as needed) |

**File operations:**

| Tool | What it does |
|---|---|
| `context_read`        | Read a file's contents; slice by line (`offset`/`limit`) |
| `context_write`       | Write a file; refuses if the path exists unless `on_conflict='overwrite'`. Triggers a per-path reindex |
| `context_edit`        | Apply git-style line-range patches |
| `context_delete`      | Remove a file or recursively a directory |
| `context_copy`        | Copy a file to a new path |
| `context_move`        | Rename or relocate a file |
| `context_info`        | Return metadata (size, lines, mime, mtime) |
| `context_exists`      | Path-existence check |
| `context_count_lines` | Count `\n` in a file's contents |

These are also exposed from the host CLI — see the `botholomew
context …` subcommands. Bare paths are interpreted as project-relative,
the same way the tools resolve them:

```bash
botholomew context tree notes
botholomew context read notes/meeting.md
botholomew context write notes/scratch.md "..."
```

---

## Structured errors from `context_read` / `context_info`

When the agent passes a path that doesn't resolve, these tools return a
structured `is_error: true` response (they do **not** throw) so the
model can recover inside the same tool loop:

```json
{
  "is_error": true,
  "error_type": "not_found",
  "message": "No file at context/notes/architecture.md",
  "next_action_hint": "Call context_tree({ path: \"notes\" }) to see what's there."
}
```

`context_read` also returns `error_type: "is_directory"` when the
target exists but is a directory.

---

## Patch format

The same patch shape is shared by every edit tool: `context_edit`,
`skill_edit`, `schedule_edit`, `task_edit`, and `prompt_edit`.

```ts
{ start_line: number, end_line: number, content: string }
```

- `start_line` / `end_line` are 1-based inclusive.
- `end_line: 0` means **insert** without replacing.
- `content: ""` means **delete** the line range.
- Patches are applied bottom-up (descending `start_line`) so earlier
  line numbers remain stable.
- The implementation lives in `src/fs/patches.ts::applyLinePatches`.
  Each tool reads the file, applies patches in memory, validates the
  result against the resource's schema (frontmatter still parses,
  required fields still present), and atomic-writes-via-rename back
  over the original. A user editing the file in `vim` at the same time
  is not corrupted; for resources guarded by mtime
  (`schedule_edit`, `task_edit`, `prompt_edit`) a concurrent change
  surfaces as `error_type: "mtime_conflict"`.

---

## Reindex on write

Every mutating tool (`context_write`, `context_edit`, `context_move`,
`context_delete`, `context_copy`) calls `reindexPath()` after the
on-disk write commits. That helper:

1. Deletes existing `context_index` rows for the path.
2. Reads the file (skipped on delete).
3. Re-chunks and re-embeds the new content.
4. Inserts fresh rows and rebuilds the FTS index.

External edits — you opening `vim context/notes/foo.md` and saving —
are picked up by a 30-second background reindex pass that any running
worker performs, or on demand via `botholomew context reindex`
(content-hash drift detection, so it only re-embeds files that
actually changed).

If `index.duckdb` is missing entirely, `botholomew context reindex
--full` rebuilds it from scratch.

See [context-and-search.md](context-and-search.md) for the chunker,
embedder, and the search itself.

---

## Why not give the agent a real shell?

An older version of this doc was titled "the virtual filesystem" and
argued that the agent's files should be DuckDB rows so a path like
`/etc/passwd` simply didn't exist in its world. That was the wrong
abstraction — it traded inspectability for safety, and we can have
both. The current model:

- **Real files**, so you can `vim`, `grep`, and `git` everything the
  agent does.
- **One sandbox helper**, so safety isn't sprinkled across 12 tools
  but lives in ~100 lines you can audit: NFC, lstat-walk, no `..`,
  no NUL, no escape, and the agent can never *write through* a
  symlink (read-through is opt-in for users who put one there).
- **No shell.** The agent never gets `rm`, `cat`, or
  `bash -c "anything"` — only the typed tools above, every one of
  which routes through the sandbox.

If you're comfortable letting a model make decisions on your behalf
but not comfortable letting it touch your disk outside `context/`,
that's exactly the trade Botholomew makes.
