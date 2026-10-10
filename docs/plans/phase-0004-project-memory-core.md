# Phase 4 — Project memory core: the versioned filesystem

> **Goal:** Every project has a versioned filesystem that people browse, read, edit, move, delete, restore,
> and diff from the web app, the CLI, and any MCP client. Every change is a new version with an author and a
> change note, keyword search finds files, and the reserved paths that hold skills and prompts refuse a
> file whose frontmatter is wrong.

> **Status: planned, not built.** Stage B — One bot that thinks. Depends on
> [phase 1](./phase-0001-clean-slate-and-shell.md) and [phase 3](./phase-0003-organizations.md).

Project memory replaces two things from v1 at once: the on-disk project tree (`prompts/`, `skills/`, notes)
and the membot knowledge store. It comes before bots because almost everything after it is a file in it. A
bot's identity, goals, and beliefs are files ([phase 5](./phase-0005-bots.md)). Oversized tool results land in
`scratch/` ([phase 8](./phase-0008-context-management.md)). Skills are `skills/<name>.md`
([phase 12](./phase-0012-skills.md)). Code mode reads and writes it through `memory.*`
([phase 11](./phase-0011-code-mode.md)). Building the store first means none of those phases invents its own
storage, history, editor, or CLI. They inherit this phase's.

The model is membot's, moved onto Postgres. A file is a chain of append-only versions addressed by a
`logical_path`. Deleting a file writes a tombstone, and history is never rewritten. What changes is
everything around the model. Postgres replaces DuckDB's process-global lock. Every version records who wrote
it and why. Writes are guarded by the version the writer last read. People and bots share one funnel, so a
skill or prompt can never be saved in a shape its loader would reject.

This phase is the filesystem, not the search engine. Search here is keyword-only, over a `tsvector`. Chunks,
embeddings, hybrid search, uploads, and converters are [phase 9](./phase-0009-memory-search-and-ingestion.md).
Bots cannot write yet. The rules for what a bot may write ship here as complete, tested predicates, but
nothing here constructs a bot writer: [phase 5](./phase-0005-bots.md) gives bots identities and
[phase 6](./phase-0006-durable-bot-loop.md) lets them act.

## Scope

**In:** the `memory_files` table (append-only versions, tombstones, a partial unique index on the current
head, author user or bot, change note, sha256, mime, lineage links, and source columns reserved for
ingestion); logical-path normalization; `MemoryOps` (`ls`, `tree`, `read` with
offset/limit/version, `write`, `edit` with v1's `LinePatchSchema`, `cp`, `mv` with history, `rm` with globs
and `-f` for match-all, `versions`, `diff`, `restore`, `info`, `manifest`, `batch`), all guarded by an
optional `expectedVersionId`; the namespace layout and the reserved-path validator registry (strict
frontmatter for skills and prompts); per-namespace write rules for human writers, plus the bot branch as
typed, tested predicates; keyword search; `project:<id>:memory` content-free live frames; audited `memory:*`
Keryx actions published as MCP tools; the first bot tool definitions; the Memory page (tree, viewer,
editor, history, diff, restore, move, delete, undelete); `botholomew memory …` including `pull` / `push`;
user docs; tests.

**Out:** chunks, embeddings, hybrid search, uploads, converters, the describer, `stats`, and `reindex`
([phase 9](./phase-0009-memory-search-and-ingestion.md)). URL ingest ([phase 19](./phase-0019-url-ingest.md)).
Refresh ([phase 20](./phase-0020-upstream-refresh.md)). Source routers and bulk sync
([phase 21](./phase-0021-source-routers-and-bulk-sync.md)). LLM-assisted ingestion
([phase 22](./phase-0022-llm-assisted-ingestion.md)). Original bytes: the `memory_blobs` table name is reserved
for [phase 23](./phase-0023-original-bytes-and-blob-policy.md), which defines it. Pruning old versions and sweeping `scratch/`
([phase 18](./phase-0018-operations.md)). Bot identities and namespace ownership
([phase 5](./phase-0005-bots.md)). Bots writing ([phase 6](./phase-0006-durable-bot-loop.md)). The `scratch/`
writer ([phase 8](./phase-0008-context-management.md)). Skill behaviour ([phase 12](./phase-0012-skills.md)).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| membot's store model | Logical paths, append-only versions, tombstones, and the "current" view (the latest non-tombstoned row per path) | [src/db/migrations/001-init.ts](https://github.com/evantahler/membot/blob/main/src/db/migrations/001-init.ts), [src/db/files.ts](https://github.com/evantahler/membot/blob/main/src/db/files.ts) |
| membot operations | Semantics to port: `read` (offset/limit/version), `write`, `move`, `remove` (globs, bare `*` needs `--force`, all-zero-match is an error), `versions`, `diff`, `info`, `tree`, `list` | [src/operations/](https://github.com/evantahler/membot/tree/main/src/operations) |
| `SERVER_INSTRUCTIONS` | The prose that teaches a model the store. Its file-model half becomes the memory section bots see | [src/mcp/instructions.ts](https://github.com/evantahler/membot/blob/main/src/mcp/instructions.ts) |
| `LinePatchSchema`, `applyLinePatches` | v1's single edit shape for every resource: 1-based ranges, applied bottom-up, `end_line: 0` inserts, empty `content` deletes | [src/fs/patches.ts](https://github.com/evantahler/botholomew/blob/v1/src/fs/patches.ts) |
| `resolveInRoot` | v1's path rules (NFC, NUL, length, `..`, containment). This phase adapts them to a database key | [src/fs/sandbox.ts](https://github.com/evantahler/botholomew/blob/v1/src/fs/sandbox.ts) |
| `PromptFrontmatterSchema`, `parsePromptFile`, `formatZodIssues` | Strict prompt frontmatter (`title`, `loading`, `agent-modification`) and readable Zod messages, ported verbatim | [src/utils/frontmatter.ts](https://github.com/evantahler/botholomew/blob/v1/src/utils/frontmatter.ts) |
| Skill parser and writer | The skill fields (`name`, `description`, `arguments[]`), `validateSkillName`, and the reserved built-in names. v1 parses leniently; 2.0 makes the same fields strict | [src/skills/parser.ts](https://github.com/evantahler/botholomew/blob/v1/src/skills/parser.ts), [src/skills/writer.ts](https://github.com/evantahler/botholomew/blob/v1/src/skills/writer.ts) |
| `prompt_edit`'s guard | Refuses a patch that clears `agent-modification`. The rule moves into the namespace predicate | [src/tools/prompt/edit.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/prompt/edit.ts) |
| `membot_edit` | The lost-update bug this phase fixes: read, patch, and write with no check that nothing changed in between | [src/tools/membot/edit.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/edit.ts) |
| `ToolDefinition` / `ToolContext` | The tool shape the memory tools are written against: Zod input and output, an `is_error` envelope, and a `group` | [src/tools/tool.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/tool.ts) |
| `AuditedAction`, RBAC middleware | Audited writes through `tx`; the membership and admin gates; `actions:permissions` | `toolexec:backend/classes/AuditedAction.ts`, `toolexec:backend/middleware/rbac.ts` |
| `satisfiesAccess` / `canWriteAgent` | The tag-list rule that bot namespaces defer to | `toolexec:backend/ops/AgentOps.ts` |
| Subscribe-time channel gate | A membership check on a client-named channel | `toolexec:backend/channels/projectNotifications.ts` |
| MCP publish policy | Human MCP mirrors HTTP, with a closed never-list | `toolexec:backend/ops/McpToolPolicyOps.ts` |
| Subscribe, then hydrate | Content-free pings plus HTTP re-reads, with no polling | `toolexec:docs/plans/phase-18-dashboard-websockets.md` |
| `MarkdownBlock`, CLI `--json` output | Rendered viewer; machine output for every command | `toolexec:frontend/src/components/MarkdownBlock.tsx`, `toolexec:cli/src/output.ts` |

What does not exist anywhere is memory scoped by tenant. Membot is a single-user file, and v1's project is a
directory on one machine.

## What this must not weaken

1. **The project is the boundary.** Every row carries `projectId`, every query filters on it, and a path is
   unique only within its project. No action reads across projects, even for someone who administers both.
2. **History is append-only.** No operation rewrites or deletes a version's content. `rm` writes a tombstone.
   Only admin-run retention ([phase 18](./phase-0018-operations.md)) ever removes old versions.
3. **A guarded write never loses a concurrent edit.** When a caller says which version it read, a mismatch is
   refused, never merged and never overwritten. `edit` always carries a version.
4. **A reserved path never holds an invalid file.** Validation runs inside the writing transaction on every
   path into a reserved namespace: `write`, `edit`, `cp`, `mv`, `restore`, and `batch`.
5. **Every change is attributed and audited.** Each version records its author, and each human mutation
   writes one audit row. Bot changes ([phase 6](./phase-0006-durable-bot-loop.md)) fill `actorBotId` /
   `onBehalfOfUserId` through the same funnel.
6. **Postgres first, then network.** A live frame is broadcast only after its transaction commits, and it
   names paths and versions, never content.
7. **Human MCP ≈ HTTP.** Every memory action is an MCP tool for human OAuth clients, under the same RBAC.
8. **A path is never trusted.** Normalization is the only way to construct a `LogicalPath`. The CLI re-checks
   every path before it touches the local disk.

## Design

### A file is a chain of versions

Each `memory_files` row is one version. Its serial `id` is the `versionId`. That id is monotonic, unique
across the database, and cheap to compare, where membot's millisecond timestamps can collide and depend
on the clock. One row per path is the **head**, marked `isCurrent = true` and enforced by a partial unique
index on `(projectId, logicalPath) WHERE isCurrent`. A tombstone is an ordinary head with `tombstone = true`
and null content. That way a deleted path still has a head to guard against, and undelete is just a restore.

A write runs as one transaction:

```
normalize path → policy check → SELECT head FOR UPDATE → compare expectedVersionId
  → (reserved path) parse + strict-validate → sha256(content)
  → identical to a live head?  return { unchanged: true, version: head }   (no new row)
  → UPDATE head SET isCurrent = false → INSERT new head (parentVersionId = old head)
  → audit row → commit → broadcast frame
```

Two concurrent creates of the same new path both find no head to lock. The loser's insert hits the partial
unique index, and that violation is reported as a version conflict, not a 500. Creating a *new* path also
takes `pg_advisory_xact_lock(projectId)` and checks that no live file sits at a prefix of the path, and none
below it. A file `notes` and a file `notes/a.md` would break both `pull` and the tree. Writes to existing
paths never take that lock.

`parentVersionId` links each version to the previous head at the same path. `derivedFromVersionId` links a
`cp`, `mv`, or `restore` to its source. `operation` (`create | write | edit | copy | move | delete |
restore`, with `ingest` added in [phase 9](./phase-0009-memory-search-and-ingestion.md)) says which one made
it. Following `derivedFromVersionId` across a `move` is what lets `versions --follow` show a renamed file's
whole life, the way `git log --follow` does. Membot keeps history "under both names" but never connects them.

### Optimistic concurrency

`expectedVersionId` has three states. Absent means an unconditional write; it is allowed and recorded. A
number must equal the current head's id; for a tombstoned path that is the tombstone's id. `null` means
create-only, and succeeds only when there is no head or the head is a tombstone. A mismatch is refused with a
typed error carrying `currentVersionId`, the current author, and `updatedAt`, plus the hint "re-read and
re-apply". Nothing is ever merged on the server.

`edit` requires `expectedVersionId`, because line numbers are meaningless without the version they were
counted against. v1's `membot_edit` reads, patches, and writes with no check, so two edits in flight
silently lose one of them. The patches are v1's `LinePatchSchema`, unchanged. This phase adds two refusals
v1 lacks: overlapping ranges, and ranges past end-of-file. Both come with a hint that names the file's
line count.

### Paths are database keys

`logical_path` is a btree key and a URL segment, not a filesystem path, so `resolveInRoot`'s containment
walk has nothing to walk. Its input rules still apply. `normalizeLogicalPath` works in this order:

1. NFC-normalize. This is v1's macOS NFD fix, and it keeps one key per visible name.
2. Turn `\` into `/`, strip a leading `/` or `./`, and collapse `//`.
3. Refuse: an empty path; NUL and C0/C1 control characters; `.` or `..` segments; a trailing `/` on a
   file; a segment with leading or trailing whitespace; any of the glob metacharacters `* ? [ ] { }`;
   more than 1,024 UTF-8 bytes; a segment over 255 bytes; more than 32 segments.

Refusing glob characters is what lets `rm` treat an argument as a glob exactly when it contains one, with no
escaping rules. The column is `COLLATE "C"`, so prefix scans use the btree and ordering is byte order on
every database locale. Paths are case-sensitive. Every refusal is a 406 that names the offending segment.
`pull` re-validates each path before mapping it under the target directory, and it refuses local symlinks.
That is the client-side half of `resolveInRoot`.

### Namespaces and the reserved-path registry

| Path | Validator | People who may write | Bots that may write (seam) |
|---|---|---|---|
| `skills/<name>.md` | Strict skill frontmatter; `name` equals the file stem; flat (no subdirectories) | Any member | Any bot, only when the project setting `botsMayWriteSkills` is on ([phase 12](./phase-0012-skills.md) adds it; without it the predicate's input is `false`) |
| `prompts/<name>.md` | Strict prompt frontmatter; flat | Admins. A project prompt shapes every bot, so writing it is writing every bot | None |
| `bots/<slug>/prompts/<name>.md` | Strict prompt frontmatter; flat | Writers of that bot ([phase 5](./phase-0005-bots.md)) | That bot, only where the current file says `agent-modification: true`; it may never flip the flag, and a prompt it creates must say `true` |
| `bots/<slug>/notes/**` | None | Writers of that bot | That bot |
| `scratch/conversations/<id>/**` | None | `rm` only | The system, for that conversation ([phase 8](./phase-0008-context-management.md)) |
| everything else | None | Any member | Any bot ([phase 6](./phase-0006-durable-bot-loop.md)) |

Read access always follows the project boundary: every member, and every bot, may read every path. The
registry is an ordered list of `{ name, match, validate?, canWrite }`. The first match wins, and "everything
else" is the fallback. The validators are v1's, with no loosening:

- **Prompts:** `PromptFrontmatterSchema` (`title`, `loading: always | contextual`, `agent-modification`),
  `.strict()`.
- **Skills:** a new `.strict()` schema over exactly the fields v1's parser reads: `name` (`validateSkillName`
  form, at most 64 characters, not a reserved built-in), `description` (1–1,024 characters), and
  `arguments[]` of `{ name, description, required, default? }`. v1's parser silently defaults a missing
  `name` and drops malformed arguments, so a typo becomes a different skill. Here it is a 406 that names the
  field.

A write that fails validation is refused with v1's `formatZodIssues` text and a hint carrying a minimal
valid header. Phase 4 has no bot rows, so the human rule for `bots/**` is "refused: bot namespaces are
created with their bot". [Phase 5](./phase-0005-bots.md) replaces it with `canWriteBot`.

The bot column is real code. `canWritePath(actor, path, ctx)` takes a `MemoryActor`
(`{ kind: "user", … } | { kind: "bot", botId, slug, onBehalfOfUserId? }`). Its bot branch is unit-tested
with literal identities. Only *constructing* a bot actor waits for later phases.

### Search is keyword-only, and its contract is final

`memory_files.searchTsv` is a stored generated column. It holds the path (separators turned into spaces)
at weight A, the description at weight B, and the first 100,000 characters of content at weight C, all
under the `english` configuration. A partial GIN index covers live heads. The cap keeps a large file under
Postgres's one-megabyte `tsvector` limit. Queries use `websearch_to_tsquery`, which gives people quoted
phrases and `-exclusions`. Ranking is `ts_rank_cd`, and `ts_headline` builds a snippet for the top hits
only.

`memory:search` already takes `mode` (only `keyword` is accepted here), `pathPrefix`, `includeHistory`,
and `limit`. Each hit already has the shape [phase 9](./phase-0009-memory-search-and-ingestion.md) returns
(`logicalPath`, `versionId`, `chunkIndex: null`, `snippet`, `score`, `keywordScore`, `semanticScore:
null`). Phase 9 widens the `mode` enum without breaking a caller. Reserved paths (`skills/`, `prompts/`,
`bots/*/prompts/`, `scratch/`) are left out unless `pathPrefix` names them. Bot notes are knowledge and are
included.

### Live frames carry no content

`project:<id>:memory` is gated at subscribe time by membership, the same way ToolExec gates
`project:<id>:notifications`. After commit, each mutation broadcasts
`{ projectId, op, paths, versionIds }`. Paths are capped at 50 per frame; beyond that a frame carries
`{ prefix, truncated: true }`. Paths are metadata every member can already list; content is never sent.
Pages subscribe first and then hydrate over HTTP, so a missed frame costs only staleness until the next
read.

### Membot feature map

This is the whole membot port. [Phase 9](./phase-0009-memory-search-and-ingestion.md) points back here.

| membot | 2.0 | Phase |
|---|---|---|
| Virtual logical paths; `ls`, `tree`, `read` with offset/limit and a version | **Bring**, with paths validated as keys | 4 |
| Append-only versions, tombstones, `versions`, `diff`, `mv` keeping history, `rm` with globs and `--force` for match-all | **Bring**, adding `restore` / undelete, author and change note on every version, `expectedVersionId`, lineage across `mv`, prefix moves, and all-or-nothing `rm` / `batch` | 4 |
| `write`; `inline:` text | **Bring** `write`; inline text becomes `memory_add` content | 4, 9 |
| `info` | **Bring** | 4 |
| Line-patch editing (v1's `membot_edit` over membot's whole-file `write`) | **Bring**, guarded by the version it was computed against | 4 |
| MCP server mode | **Bring**: memory actions are Keryx MCP tools for human OAuth clients | 4 |
| `SERVER_INSTRUCTIONS` | **Bring** as the memory section of the system prompt: the file half here, the search half later | 4, 9 |
| FTS keyword search | **Adapt** to `tsvector` (per file here, per chunk later) | 4, 9 |
| Markdown-aware chunker, `buildSearchText`, local bge-small 384-d WASM embeddings | **Bring**, on the `embed` queue | 9 |
| Embedding revision and `reindex` | **Bring**, admin-only | 9 |
| Hybrid RRF (k = 60, semantic weight 0.6), `max_per_file` with backfill, snippets, `mode`, `path_prefix`, `include_history` | **Bring**: pgvector HNSW plus `tsvector` GIN, with fusion in TypeScript | 9 |
| `mv` copies stale embeddings onto the new path | **Fix**: a move re-embeds | 9 |
| Converters: text, PDF, DOCX, HTML, XLSX, PPTX | **Bring**, deterministic, in the worker | 9 |
| Describer from H1 or deterministic fallback | **Bring** | 9 |
| Local files, directories, globs read by the server | **Adapt**: the CLI walks them and uploads; the server never reads a host path | 9 |
| `stats` | **Bring** | 9 |
| Embedder subprocess pool | **Drop**: one in-process embedder thread per process | 9 |
| URL ingest (membot only has per-service downloaders, with no generic web fetch) | **Adapt**: a public fetch behind the SSRF guard, plus HTML→md | 19 |
| `refresh`, `refresh_frequency`, the refresh daemon | **Adapt**: a `memory:refresh-due` clock that writes a new version only when the sha changes | 20 |
| Downloaders (`github`, `github-repo`, `linear`, `linear-team`), `--sync`, `sources` | **Adapt** into MCP-backed source routers with bulk sync | 21 |
| Custom shell-command routers | **Drop** the shell; MCP routers replace it | 21 |
| Image vision captions, LLM conversion fallback, LLM describer | **Bring** on the project's BYOK fast model | 22 |
| Original bytes, blob policy (25 MB cap, skip video/audio), blob sha dedupe, `read --bytes`, `prune --strip-blob-bytes` | **Bring**: per-project `bytea`; earlier phases keep only the markdown surrogate and its sha | 23 |
| `prune --before` | **Bring** as admin-only retention | 18 |
| Cross-encoder rerank | Later, unphased, opt-in | later |
| LLM chunker mode (a config knob with no implementation) | **Drop** | dropped |
| apple-notes, `skill install`, `login`, `config.json` secrets, the serve-mode log, self-update | **Drop**; the audit log and transcripts replace the serve log | dropped |
| Process-global state, DuckDB file locks, FTS rebuilt on every write and query | **Gone**: Postgres rows with `projectId`, incremental indexes | 4 |

## Decisions so far

| Question | Decision |
|---|---|
| Version identity | The serial row id, exposed as `versionId` (integer). It is not a timestamp |
| Writing identical content | A no-op that returns `unchanged: true` and creates no version |
| A file and a directory with the same name | Refused when the path is created, under a per-project advisory lock |
| Binary content | Not in this phase; writes must be UTF-8 text of at most `MEMORY_MAX_FILE_BYTES` (5 MiB). Binaries arrive with uploads in [phase 9](./phase-0009-memory-search-and-ingestion.md), and their original bytes in [phase 23](./phase-0023-original-bytes-and-blob-policy.md) |
| Project settings | None in this phase. The skills gate reads `botsMayWriteSkills`, which [phase 12](./phase-0012-skills.md) adds; memory's own knobs arrive in `memory_settings` with [phase 9](./phase-0009-memory-search-and-ingestion.md) |
| What the audit row carries | Version metadata only (path, `versionId`, sha, size, change note). The version table is the content record |
| `rm` across many paths | All-or-nothing in one transaction, capped at 1,000 matches. Membot reports per-entry failures because DuckDB cannot do better |
| `push` | All-or-nothing through `memory:batch` (at most 200 operations), each guarded by the manifest's version |
| Who writes project-wide `prompts/` | Admins only; bots never |

## Steps

### 1. Schema — `backend/schema/memory_files.ts`

`memory_files` (one row per version):

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` | The `versionId` |
| `projectId` | `integer` | → `projects.id`, cascade |
| `logicalPath` | `text COLLATE "C"` | Normalized; see the rules above |
| `isCurrent`, `tombstone` | `boolean` | The head flag; a tombstone head has null content |
| `content` | `text` | UTF-8 markdown or text; `CHECK (tombstone = (content IS NULL))` |
| `contentSha256` | `varchar(64)` | Null for tombstones |
| `sizeBytes`, `lineCount` | `integer` | |
| `mimeType` | `varchar(128)` | Default `text/markdown`; set from the extension (`.json`, `.yaml`, `.csv`, …) |
| `description` | `text` | Author-set here; [phase 9](./phase-0009-memory-search-and-ingestion.md) derives it when absent |
| `frontmatter` | `jsonb` | Parsed reserved-path frontmatter, so prompt and skill listings do not re-parse |
| `operation` | `varchar(16)` | `create \| write \| edit \| copy \| move \| delete \| restore` |
| `parentVersionId`, `derivedFromVersionId` | `integer` | Self-references, `set null` |
| `authorUserId`, `onBehalfOfUserId` | `integer` | → `users.id`, `set null` |
| `authorBotId` | `integer` | No foreign key yet; [phase 5](./phase-0005-bots.md) adds one with `set null` |
| `changeNote` | `varchar(1000)` | |
| `sourceType` | `varchar(16)` | Default `inline`. Reserved for ingestion: `upload` ([phase 9](./phase-0009-memory-search-and-ingestion.md)), `url` ([phase 19](./phase-0019-url-ingest.md)), `router` ([phase 21](./phase-0021-source-routers-and-bulk-sync.md)) — membot calls the URL case `remote` |
| `sourceUri`, `sourceSha256`, `sourceMimeType`, `sourceFilename` | `text`, `varchar(64)`, `varchar(128)`, `text` | Reserved for ingestion: where the bytes came from, the sha of the source bytes, their sniffed mime, and an upload's original name. Declared now so ingestion adds no columns to a table that already has rows; fetch-specific columns (final URI, ETag, fetcher args) arrive with [phase 19](./phase-0019-url-ingest.md) |
| `searchTsv` | `tsvector` | Generated, stored |
| `createdAt` | `timestamp(withTimezone)` | `defaultNow()` |

Indexes: a unique index on `(projectId, logicalPath) WHERE isCurrent`; an index on `(projectId,
logicalPath, id DESC)` for history and prefix scans; GIN on `searchTsv WHERE isCurrent AND NOT tombstone`.

### 2. Config — `backend/config/memory.ts`

`maxFileBytes` (`MEMORY_MAX_FILE_BYTES`, 5 MiB), `readDefaultLines` (2,000), `maxRmMatches` (1,000),
`maxBatchOps` (200), `maxTreeEntries` (5,000), `searchMaxLimit` (50).

### 3. Ops — `backend/ops/{MemoryPathOps,MemoryNamespaceOps,MemoryOps,MemorySearchOps}.ts`

- `MemoryPathOps`
  - `normalizeLogicalPath(input): LogicalPath` (a branded type), plus `normalizePrefix` and `isGlob`.
  - Every refusal is a 406 keyed on the parameter that carried the path.
- `MemoryNamespaceOps`
  - `RESERVED_PATH_RULES`; `ruleFor(path)`.
  - `validateReservedContent(rule, path, content)` returns `{ frontmatter }` or the issues.
  - `canWritePath(actor, path, ctx)` returns allowed, or denied with a hint.
  - The ported `PromptFrontmatterSchema`, `SkillFrontmatterSchema`, `formatZodIssues`, and
    `RESERVED_SKILL_NAMES`.
  - `resolveBotNamespace(projectId, slug)`, which returns `null` in this phase; [phase 5](./phase-0005-bots.md) gives it
    bots to resolve.
- `MemoryOps` (each mutation takes `tx` and a `MemoryActor`, and returns the new head)
  - `readFile`, `fileInfo`, `listEntries`, `buildTree`, `listVersions`, `diffVersions`, `manifest`.
  - `writeFile`, `editFile`, `copyFile`, `moveFile`, `movePrefix`, `removePaths`, `restoreVersion`,
    `applyBatch`.
  - `serializeMemoryVersion`, which never includes content.
  - `queueMemoryFrame(tx, frame)`, which fires after commit.
  - `diffVersions` uses jsdiff. It returns unified text and structured hunks, so the web app draws
    side-by-side without a client diff library.
- `MemorySearchOps`: `searchKeyword(projectId, params)` returns hits in the final shape.

### 4. Actions — `backend/actions/memory/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory:ls` | `GET /memory/ls` | `ProjectMemberMiddleware()` | — | yes |
| `memory:tree` | `GET /memory/tree` | member | — | yes |
| `memory:read` | `GET /memory/file` | member | — | yes |
| `memory:info` | `GET /memory/info` | member | — | yes |
| `memory:versions` | `GET /memory/versions` | member | — | yes |
| `memory:diff` | `GET /memory/diff` | member | — | yes |
| `memory:search` | `GET /memory/search` | member | — | yes |
| `memory:manifest` | `GET /memory/manifest` | member | — | yes |
| `memory:write` | `PUT /memory/file` | member + `canWritePath` | yes | yes |
| `memory:edit` | `POST /memory/file` | member + `canWritePath` | yes | yes |
| `memory:cp` | `PUT /memory/copy` | member + `canWritePath` (destination) | yes | yes |
| `memory:mv` | `POST /memory/move` | member + `canWritePath` (source and destination) | yes | yes |
| `memory:rm` | `DELETE /memory/file` | member + `canWritePath` (every match) | yes | yes |
| `memory:restore` | `POST /memory/restore` | member + `canWritePath` | yes | yes |
| `memory:batch` | `POST /memory/batch` | member + `canWritePath` (every operation) | yes, one row per batch | yes |

The rest of the action contracts:

- **Paginated lists.** `memory:ls`, `memory:versions`, `memory:manifest`, and `memory:search` take
  `paginationInputs`.
- **`memory:ls`** lists one level, with directory entries synthesized from path segments, like `ls`.
  `recursive: true` gives a flat recursive list, and `includeDeleted` shows tombstoned heads for undelete.
- **`memory:read`** returns at most `readDefaultLines` unless the caller passes `limit`. It always returns
  `totalLines`, `truncated`, and `nextOffset`. A model reading through a human's MCP client is still a
  model, and a 5 MiB file in one tool result is the v1 lesson about big content.
- **Descriptions.** Each action's `description` is the text an MCP client shows a model, so it states
  versioning and the `expectedVersionId` contract.

### 5. Channel — `backend/channels/projectMemory.ts`

The channel is `/^project:(\d+):memory$/`, with a `ChannelMiddleware` that requires a session and a
membership row. A malformed name is refused rather than thrown.

### 6. Bot tools — `backend/bots/tools/{tool.ts,memory/*.ts}`

`tool.ts` ports v1's `ToolDefinition` shape. Its context carries a `MemoryActor` and `projectId` instead of
`withMem`. The memory tools are its first members. No bot receives them here;
[phase 6](./phase-0006-durable-bot-loop.md) adds the execution half: the registry, replay, and the effect
sandwich. Each tool's `description` begins with a bash tag, and each returns the PATs envelope
`{ is_error, error_type, message, next_action_hint }`.

| Tool | Tag | Replay | Inputs |
|---|---|---|---|
| `memory_ls` | `ls` | safe | `prefix?`, `recursive?` |
| `memory_tree` | `tree` | safe | `prefix?`, `max_depth?` |
| `memory_cat` | `cat` | safe | `logical_path`, `version_id?`, `offset?`, `limit?` (returns `version_id` for the next edit) |
| `memory_search` | `grep -r` | safe | `query`, `path_prefix?`, `include_history?`, `limit?` |
| `memory_write` | `tee` | unsafe | `logical_path`, `content`, `change_note?`, `expected_version_id?` |
| `memory_edit` | `patch` | safe | `logical_path`, `expected_version_id`, `patches[]`, `change_note?` |
| `memory_cp` / `memory_mv` / `memory_rm` | `cp` / `mv` / `rm` | unsafe | Path arguments and `change_note?`; `rm` takes `paths[]` and `force?` |
| `memory_versions` / `memory_diff` / `memory_info` | `git log` / `diff` / `stat` | safe | `logical_path` and versions |

`memory_edit` is replay-safe because it is guarded. A re-run either applies once or hits a conflict.
`backend/bots/prompt/memorySection.ts` holds the file half of `SERVER_INSTRUCTIONS` (paths, versions,
"read before you write") with the tool names generated from the registry.

### 7. Frontend — `frontend/src/pages/MemoryPage.tsx`, `frontend/src/components/memory/*`

`/memory/*` takes the logical path as the route splat, so links are shareable. The page has:

- **Tree and viewer.** `MemoryTree` (lazy per directory, with a "show deleted" toggle) beside
  `MemoryViewer` (`MarkdownBlock`, raw toggle, frontmatter shown as a table for reserved paths).
- **Search bar.** `MemorySearchBar` searches by keyword, with prefix and history filters.
- **Info panel.** `MemoryInfoPanel` shows author, change note, size, mime, version count, and which rule
  governs the path.
- **Editor.** `MemoryEditor` is a monospace textarea with preview, a required change-note field, and
  `expectedVersionId` set to the version it opened. A 406 from a validator renders inline under the
  frontmatter. On a conflict it opens a dialog with "view diff (your draft ↔ current)", "overwrite", and
  "discard". The draft is kept in `localStorage`, keyed by path and version, so a conflict never loses
  text.
- **History.** `MemoryHistory` lists versions, with `--follow` across moves, and `MemoryDiff` shows the
  unified or split view. Both have Restore, and a deleted file has Undelete.
- **File operations.** Rename/move (a directory moves as a prefix), delete with a confirmation that lists
  matches.

It subscribes to `project:<id>:memory`, then hydrates. Navbar link: Memory.

### 8. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory ls [prefix] [-R] [--deleted]` | Paginated (`--page`, `--limit`) |
| `botholomew memory tree [prefix] [--depth n]` | |
| `botholomew memory read <path> [--version v] [--offset n --limit n] [--raw]` | Renders markdown on a TTY |
| `botholomew memory info <path> [--version v]` / `versions <path> [--follow]` / `diff <path> <a> [b]` | |
| `botholomew memory search <query> [--prefix p] [--history]` | |
| `botholomew memory write <path> [-m note] [--expect v]` | Content from stdin |
| `botholomew memory edit <path> [-m note]` | Opens `$EDITOR` on the current version and saves with that version. On a conflict, it keeps the temp file and prints its path |
| `botholomew memory cp/mv <from> <to> [-m note]`, `rm <paths…> [-f] [-m note]` | Quote globs; `-f` is required for `*` |
| `botholomew memory restore <path> --version v [-m note]` | Also undeletes |
| `botholomew memory pull <prefix> <dir>` | Writes the files plus `.botholomew-memory.json` (path → `versionId`, sha) |
| `botholomew memory push <dir> [--delete] [--dry-run] [--force]` | Diffs local shas against the manifest and sends one `memory:batch`, guarded by the manifest's versions. Deletes only with `--delete`; refuses symlinks and dotfiles; on success, rewrites the manifest |

`--json` works on every command.

### 9. User docs — `frontend/src/content/docs/memory.md`

A new page, registered in `sections.ts`. It covers paths and their rules, versions and restore, the
namespaces and what each validates, conflicts, keyword search syntax, and `pull` / `push`. Update `cli.md`
and `mcp.md`.

### 10. Tests — `backend/__tests__/…`

- **`actions/memory-files.test.ts`**
  - A write creates a version; identical content returns `unchanged` with no new row.
  - A stale `expectedVersionId` is refused with `currentVersionId`.
  - Create-only on a live path conflicts; create-only on a tombstoned path succeeds.
  - **Two concurrent creates: exactly one wins.**
  - `edit` without a version is a 406; overlapping patches are refused.
  - v1's `applyLinePatches` fixtures produce byte-identical output.
  - `mv` tombstones the source, and `versions --follow` walks across the move.
  - Creating `a/b` under a live `a` is refused.
- **`actions/memory-rm.test.ts`**
  - A bare `*` without `force` is refused and reports the count.
  - `dir/**` matches the subtree; a literal directory gets the `dir/**` hint.
  - An argument that matches nothing names itself.
  - One forbidden match refuses the whole call and tombstones nothing.
- **`ops/memory-paths.test.ts`**: one row per normalization rule (NFD → NFC, `..`, `.`, `//`, `\`, NUL,
  control characters, glob characters, the byte and segment caps, segment whitespace, trailing `/`).
- **`actions/memory-reserved.test.ts`**
  - The strict schemas refuse unknown keys, a missing field, a `name` that differs from its file, a nested
    skill, and a reserved skill name.
  - **Every mutating action** (`write`, `edit`, `cp`, `mv`, `restore`, `batch`) is refused when it would
    leave an invalid reserved file.
  - Non-admins are refused on `prompts/`; `bots/**` is refused; `scratch/` accepts `rm` and refuses writes.
  - The bot-branch predicates are tested with literal identities: a flip of `agent-modification` is
    refused, as is another bot's prompt, and skills are gated by the setting.
- **`actions/memory-search.test.ts`**
  - Ranking puts a title hit above a body hit.
  - Reserved paths are excluded by default and included when the prefix names them.
  - `includeHistory` finds superseded text; tombstones are never returned.
  - Quoted phrases and `-exclusion` work.
  - **Another project's file never appears.**
- **`actions/memory-rbac.test.ts`**
  - The outsider gets 403 on every `memory:*` action.
  - `actions:permissions` declares each action.
  - A human OAuth client (`getMcpAccessToken`) sees the memory tools and can `memory:read` over MCP.
- **`actions/memory-audit.test.ts`**: each mutation writes exactly one audit row whose before/after holds
  no `content` key, and no version is written without an author.
- **`channels/project-memory.test.ts`**
  - A member receives a frame whose keys are exactly `projectId`, `op`, `paths`, `versionIds`.
  - **A non-member is refused and receives nothing.**
  - A rolled-back write broadcasts nothing.
- **`cli/__tests__/memory.test.ts`**
  - `pull` then `push` with no changes sends nothing.
  - A server edit between the two makes `push` apply nothing and name the conflict.
  - Symlinks are refused.
  - `edit` with `EDITOR` set to a script that appends a line saves a new version.
- **`frontend/e2e/memory.spec.ts`**
  - Create, edit with a note, view history and diff, restore, delete, undelete.
  - Two contexts editing the same file get the conflict dialog.
  - The tree updates without a reload.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, in two browser windows signed in as two members of the same project:

1. Window A creates `notes/plan.md` with a change note. Window B's tree shows it without a reload.
2. Both open the editor on it. A saves; then B saves. B gets the conflict dialog, views the diff, and
   overwrites deliberately. History shows two authors and two notes.
3. Restore the first version, then rename the file to `archive/plan.md`. History with "follow" shows all
   four versions across the rename.
4. As a non-admin, try to create `prompts/house-style.md`; it is refused. As an admin, save it without
   `loading:`; the 406 names the missing field. Fix it and save.
5. `botholomew memory pull notes ./notes`, edit a file locally, edit the same file in the browser, then
   `botholomew memory push ./notes`. It refuses and names the file. Re-pull, edit, and push again.
6. `botholomew memory search "plan -draft"` finds the archive file. `botholomew memory rm '*'` refuses
   without `-f`.

Then the edge cases:

- Save the same content twice: no new version appears in history.
- Delete `archive/`, toggle "show deleted", and undelete one file.
- Connect a human MCP client and ask it to list and read memory. Large files arrive truncated, with
  `nextOffset`.
- A non-member's socket subscription to `project:<id>:memory` is refused in the console.

## Definition of done

- [ ] `memory_files` with the partial unique head index, tombstone check, lineage columns, reserved source
      columns, and generated `searchTsv`
- [ ] `normalizeLogicalPath` enforces every rule above and is the only constructor of `LogicalPath`
- [ ] Every mutation runs one transaction: head lock, version guard, reserved-path validation, audit row,
      and frame after commit; identical content is a no-op
- [ ] `edit` requires `expectedVersionId` and uses v1's `LinePatchSchema`, plus overlap and range checks
- [ ] `rm` globs with match-all `force`, all-or-nothing; `mv` keeps lineage and moves prefixes; `restore`
      undeletes
- [ ] Reserved-path registry with strict skill and prompt schemas; per-namespace write rules for people;
      a tested bot branch
- [ ] Keyword search with the final hit shape, default exclusion of reserved paths, and `includeHistory`
- [ ] `project:<id>:memory` channel, membership-gated, with content-free frames
- [ ] `memory:*` actions audited and MCP-published; paginated lists
- [ ] Memory bot tool definitions with bash tags, replay declarations, and PATs envelopes; the
      memory-section prompt text
- [ ] Memory page: tree, viewer, editor with a conflict dialog, history, diff, restore, move, delete,
      undelete
- [ ] `botholomew memory …`, including `edit` via `$EDITOR` and a manifest-guarded `pull` / `push`
- [ ] `memory.md`, `cli.md`, and `mcp.md` updated
- [ ] All the tests above pass twice in a row

## Commands

A sketch of the operator path; none of these exist yet.

```bash
botholomew memory write notes/plan.md -m "first cut" < plan.md
botholomew memory edit notes/plan.md -m "tighten scope"          # $EDITOR, guarded by the opened version
botholomew memory versions archive/plan.md --follow --json
botholomew memory diff archive/plan.md 41 57
botholomew memory rm 'scratch/**' -f -m "clear scratch"
botholomew memory pull skills ./skills && $EDITOR ./skills/standup.md && botholomew memory push ./skills
psql botholomew -c "select id, logical_path, is_current, tombstone, operation, author_user_id
                    from memory_files where project_id = 1 order by id desc limit 10;"
```

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
