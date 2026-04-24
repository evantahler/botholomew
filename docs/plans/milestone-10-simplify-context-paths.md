# Milestone 10: Simplify Context Paths — Drives Replace Virtual Paths

## Context

Today, every context item carries **two** paths:

- `source_path` — where it came from (absolute disk path or URL; nullable).
- `context_path` — a virtual filesystem path unique across the DB.

That's confusing and pulls its weight poorly. The two diverge most of the time (a file at `/Users/evan/code/README.md` on disk ends up at `/projects/monaco/README.md` in context), collisions require a second LLM pass to invent a disambiguated path, and the agent sees only the virtual path — never the origin. The result:

- `context add` pays for an LLM call per file just to "pick a folder." See `src/context/describer.ts:209` and `src/commands/context.ts:316–378`.
- There's no way to tell where an item came from by looking at its path. Two identical filenames from different origins must be distinguished by inventing structure.
- URL items go through a slugifier (`urlToContextPath` in `src/context/url-utils.ts:17`) that loses information the agent might need.

This milestone collapses the two columns into a single path-with-origin: **`drive:/path`**. The drive names the origin (`disk`, `url`, `agent`, `google-docs`, `github`, …) and the path is whatever the origin naturally uses. Disk items keep their absolute disk path. URL items keep their URL. Agent-authored items default to `agent:/…`. No more LLM placement; origin *is* identity.

## Goal

Remove `context_path` from the data model. Every item is identified by `(drive, path)` where `drive` names the origin (disk, url, agent, google-docs, github, …) and `path` is the origin's natural path. Drop all LLM-driven placement.

## What this unblocks

- Ingest is deterministic and cheap — no LLM pass to pick a folder.
- The agent sees true origins, which matters for search results and refresh errors.
- New origins (MCP services) get a dedicated drive instead of being squashed into `source_type='url'`.
- Two files with the same basename from different drives coexist with zero disambiguation logic.

## Decisions

1. Agent-authored content defaults to drive `agent:/`; `context_write` can still target any drive.
2. **Destructive migration.** Wipe `context_items` + `embeddings` on migrate. Pre-1.0, no backcompat promise.
3. Drive is service-level: `disk:/`, `url:/`, `agent:/`, `google-docs:/`, `github:/`, etc. (not `url:google-docs/…`).
4. Tool names unchanged (`context_read`, `context_write`, …). Each gains a required `drive` parameter alongside `path`.

---

## Implementation

### 1. Migration 13 (`src/db/sql/13-drive-paths.sql`)

DuckDB has weak `ALTER TABLE` support (no `DROP COLUMN` on certain setups, no `SET NOT NULL`), so this is a table rebuild. Order of operations:

1. `DELETE FROM embeddings;`
2. `DELETE FROM context_items;`
3. Drop VSS/HNSW indexes that reference the old embeddings table (see `src/db/sql/6-vss_index.sql` and `11-rebuild_hnsw.sql`).
4. Drop the unique index on `context_path` (from `4-unique_context_path.sql`).
5. Drop + recreate both tables via `CREATE TABLE … AS SELECT` with the new shape, then rename into place.
6. Re-create VSS index + unique `(drive, path)` index.

### 2. New `context_items` shape

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUIDv7, unchanged |
| `title` | TEXT NOT NULL | unchanged |
| `description` | TEXT | unchanged |
| `content` | TEXT | unchanged |
| `content_blob` | BLOB | unchanged |
| `mime_type` | TEXT | unchanged |
| `is_textual` | BOOLEAN | unchanged |
| **`drive`** | TEXT NOT NULL | new: `disk` / `url` / `agent` / `google-docs` / `github` / … |
| **`path`** | TEXT NOT NULL | new: replaces both `source_path` and `context_path` |
| `indexed_at` | TEXT | unchanged |
| `created_at` / `updated_at` | TEXT | unchanged |

**Dropped:** `source_path`, `source_type`, `context_path`.

**New unique index:** `UNIQUE(drive, path)` — replaces the old `context_path` unique index. This index is the **identity key** for context items: `context add` uses it to decide whether an ingest is a new insert or a refresh of an existing row (same logic that `getContextItemBySourcePath` powered before). `PathConflictError` is thrown when an explicit write (e.g. `context_write`) would violate it.

### 3. Embeddings table

- Drop `source_path TEXT` (redundant — reachable via `context_item_id → context_items`).
- No other changes.

### 4. Path semantics per drive

| Drive | Path shape | Example | Source of truth |
|---|---|---|---|
| `disk` | absolute filesystem path | `disk:/Users/evan/notes/meeting.md` | `resolve(localPath)` at ingest time |
| `url` | full URL (including scheme) | `url:/https://example.com/post` | fallback when no service-specific drive applies |
| `agent` | arbitrary agent-chosen path | `agent:/notes/scratch.md` | `context_write` default |
| `google-docs` | doc id | `google-docs:/1AbCdEfGh...` | parsed from URL in fetcher |
| `github` | `/<owner>/<repo>/<rest>` | `github:/evantahler/botholomew/README.md` | parsed from URL in fetcher |

The `path` column stores just the path half (`/Users/evan/notes/meeting.md`). The `drive:/path` form is purely a display/API convention. Two columns keeps `WHERE drive = 'disk'` fast and lets us index prefix queries within a drive.

New drive-detection helper: `src/context/drives.ts` with `detectDriveFromUrl(url, mcpxServerName?)` → `{ drive, path }`. Initial registry covers `google-docs`, `github`, and `url` fallback; more can be added incrementally.

### 5. Code changes

**Drop (LLM-placement is gone)**

- `src/context/describer.ts`:
  - Remove `DESCRIBE_AND_PLACE_TOOL`, `DESCRIBE_AND_PLACE_TOOL_NAME`, `generateDescriptionAndPath`, `sanitizeSuggestedPath`, and the `includePlacement` branch in `buildMessageContent`. Keep `generateDescription` for titles/summaries.
- `src/commands/context.ts`:
  - Delete Phase 1.5 placement block (lines 316–379), `renderExistingTree`, `suggestPathForFile`, `confirmYesNo` (only used by placement).
  - Delete `--prefix`, `--name`, `--auto-place` flags. They have no meaning once path = source.
- `src/context/url-utils.ts`:
  - Delete `urlToContextPath`. Keep `isUrl`, `stripHtmlTags`.

**Rewrite**

- `src/db/context.ts`:
  - `ContextItem` shape: drop `source_path`, `source_type`, `context_path`. Add `drive`, `path`.
  - Rename `getContextItemByPath` → `getContextItem(db, { drive, path })`.
  - Drop `getContextItemBySourcePath` (no longer distinct from the above).
  - `resolveContextItem(db, ref)` accepts `"drive:/path"` form or a UUID. Still used by CLI.
  - `listContextItemsByPrefix(db, drive, prefix, …)` — prefix queries scope to a drive.
  - `findNearbyContextPaths` — same idea, scoped to a drive.
  - `PathConflictError.contextPath` → `{ drive, path }`.
- `src/commands/context.ts` — `add` command:
  - For each local file: `drive = "disk"`, `path = resolve(input)`.
  - For each URL: call `detectDriveFromUrl` → yields `{ drive, path }`.
  - Phase 0 dedup keys off `UNIQUE(drive, path)` via `getContextItem({drive,path})`: a hit means "already in context — refresh or skip per `--on-conflict`"; a miss means "new insert." No separate `source_path` lookup anymore — the one index answers both questions.
  - No placement prompt, no description+path LLM call; description still runs in the add phase if useful.
- `src/tools/*`:
  - Every tool under `src/tools/file/*` and `src/tools/dir/*` gains a required `drive` param in its Zod schema. `path` stays.
  - `ToolContext` unchanged.
  - Update resolution helpers (`resolveContextItem`) to take `{ drive, path }`.
  - New tool **`context_list_drives`** (no-arg) → `[{drive, count}]`. Agent discovery aid, since `drive` is now required everywhere.
- `src/context/fetcher.ts`:
  - Return `{ drive, path, title, content, mimeType }` instead of just content. Populate `drive` from `detectDriveFromUrl` using the MCP server name the fetch was routed through.
- `src/context/refresh.ts`:
  - Dispatch on `drive` instead of `source_type`. `disk` → read from FS, `url` / `google-docs` / `github` / any-non-`disk`-non-`agent` → `fetchUrl`. `agent` → skip (nothing to refresh).
- `src/tools/search/semantic.ts`:
  - Display `drive:/path` in results instead of `source_path || context_item_id`.
- `src/db/embeddings.ts`:
  - Drop `source_path` from the embedding row shape; update `getEmbeddingsForItem`, `hybridSearch` select lists, and `createEmbedding`.
- `src/tui/markdown.ts`:
  - `isMarkdownItem` now checks `path.toLowerCase().endsWith(".md")` (only one path to check).

**Keep unchanged**

- `src/context/chunker.ts`, `src/context/embedder.ts`, `src/context/ingest.ts` (body — interface changes are minor).
- `src/db/connection.ts`, `withDb`, migration loader.

### 6. Agent-facing tool contracts

Every tool that took `path: string` now takes `{ drive: string, path: string }`. Descriptions spell out the drive values and reference `context_list_drives` for discovery. Example:

```ts
// context_read
{
  drive: "disk",               // required — use `context_list_drives` to see what's available
  path: "/Users/evan/notes/meeting.md",
  offset?: number,
  limit?: number,
}
```

CLI form accepts the compact `drive:/path`:

```
botholomew context read disk:/Users/evan/notes/meeting.md
botholomew context delete google-docs:/1AbCd...
botholomew context tree disk:/Users/evan/notes
```

`resolveContextItem(db, "disk:/Users/evan/notes/meeting.md")` parses the leading `drive:` before the first `/`.

---

## Files touched

| File | Change |
|---|---|
| `src/db/sql/13-drive-paths.sql` | **New** migration: wipe + rebuild tables with `(drive, path)` |
| `src/db/schema.ts` | No code change; numeric-sort is already in place (M9) |
| `src/db/context.ts` | Rewritten types + resolvers around `(drive, path)` |
| `src/db/embeddings.ts` | Drop `source_path` column/field; update queries |
| `src/context/describer.ts` | Remove placement APIs; keep `generateDescription` |
| `src/context/fetcher.ts` | Return `{drive, path, ...}`; consume MCP server name |
| `src/context/refresh.ts` | Dispatch on `drive` |
| `src/context/drives.ts` | **New** — `detectDriveFromUrl`, drive registry |
| `src/context/url-utils.ts` | Delete `urlToContextPath` |
| `src/commands/context.ts` | Drop Phase 1.5 + placement flags + helpers |
| `src/tools/file/{read,write,edit,move,copy,delete,info,exists,count-lines}.ts` | Add `drive` param |
| `src/tools/dir/{list,tree,size,create}.ts` | Add `drive` param |
| `src/tools/context/{search,refresh}.ts` | `drive`-aware |
| `src/tools/context/list-drives.ts` | **New** |
| `src/tools/registry.ts` | Register `context_list_drives` |
| `src/tools/search/semantic.ts` | Display `drive:/path` |
| `src/tui/markdown.ts` | One-path check |
| `docs/virtual-filesystem.md` | Rewrite |
| `docs/context-and-search.md` | Remove placement; document drives |
| `docs/tools.md` | Drive param docs |
| `README.md` | Examples + CLI table |
| `docs/plans/README.md` | Add M10 row |

## Tests

Updated (paths/shape only):
- `test/db/context.test.ts` — `(drive, path)` unique, new CRUD signatures
- `test/context/ingest.test.ts`
- `test/context/refresh.test.ts`
- `test/tools/context-refresh.test.ts`, `test/tools/context-search.test.ts`, `test/tools/file.test.ts`, `test/tools/dir/*`
- `test/tui/markdown.test.ts`
- `test/db/schema.test.ts` — migration count is 13

New:
- `test/context/drives.test.ts` — `detectDriveFromUrl` cases (google docs id extraction, github path parsing, plain-URL fallback, MCP server-name hinting)
- `test/tools/context-list-drives.test.ts`
- `test/commands/context-add-no-placement.test.ts` — add a file from disk, assert `drive = "disk"` and `path` is the absolute source path, with no LLM call

Removed:
- All tests of `generateDescriptionAndPath` / `sanitizeSuggestedPath` / `urlToContextPath` / `renderExistingTree`.

---

## Verification

1. `bun run lint` clean.
2. `bun test` — all passing, new tests above included.
3. Manual smoke (from a fresh `.botholomew/`):
   - `botholomew context add ~/notes/foo.md` → item stored at `disk:/Users/.../notes/foo.md`, no LLM call, instant return. `context list` shows `disk` drive.
   - `botholomew context add https://github.com/evantahler/botholomew/blob/main/README.md` → item at `github:/evantahler/botholomew/README.md`.
   - `botholomew context add https://example.com/post` (no MCP) → item at `url:/https://example.com/post`.
   - `botholomew context write agent:/notes/scratch.md "hi"` → item at `agent:/notes/scratch.md`.
   - `botholomew context tree disk:/Users/evan/notes` renders hierarchy as expected.
   - `botholomew context refresh disk:/Users/evan/notes/foo.md` re-reads disk.
   - Chat: ask the agent to read the item, then call `context_list_drives` → lists the three drives above with counts.
4. Bump `version` in `package.json`.

## Status: **Done**
