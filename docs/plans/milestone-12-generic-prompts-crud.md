# Milestone 12: Generic Prompts with Strict Frontmatter and Full CRUD

## Context

`prompts/` started life as a fixed cast: `soul.md`, `beliefs.md`, `goals.md`,
`capabilities.md`. The loader, init, docs, and tools all assumed those four
filenames. The agent had `prompt_read` and `prompt_edit` but no way to list,
create, or delete prompts; the CLI had no surface for them at all. Frontmatter
was loose-typed (a TypeScript interface, not a schema), so a malformed file
would silently be skipped and the agent would behave as if the prompt didn't
exist.

This milestone reframes `prompts/` as a generic markdown bag: anything that
parses against a strict frontmatter schema is a first-class prompt. New
projects still get sensible seeds, but there is nothing special about their
filenames — users and the agent can drop in, edit, or delete any prompt they
want.

## Goal

- Drop hard-coded knowledge of specific prompt filenames everywhere outside of
  the init seeds and the auto-generated `capabilities.md` writer.
- Make frontmatter validation strict and loud at load time so malformed files
  block the worker / chat with a named path instead of being silently dropped.
- Give both the agent and the user full CRUD over the `prompts/` directory.

## Decisions

1. **Three required frontmatter fields, no extras.** `title` (non-empty
   string), `loading` (`always` | `contextual`), `agent-modification`
   (boolean). Validated via a Zod `.strict()` schema that rejects unknown
   keys.
2. **Collapse `soul.md` into `goals.md`.** The wise-owl identity prose moves
   into the seeded `goals.md`. Init no longer writes a `soul.md`. Existing
   user projects keep theirs as a normal prompt — no migration code.
3. **`capabilities.md` stays specially generated.** The CLI command and the
   `capabilities_refresh` tool still scan the tool registry and rewrite the
   body, but the file itself is just a normal prompt. `writeCapabilitiesFile`
   sets/preserves `title: Capabilities`.
4. **Fail loudly on load.** A bad prompt fails the worker tick (with the task
   marked `failed` and the offending path in the reason) or refuses the chat
   turn. There is no quarantine mode.
5. **Reuse the shared git-hunk patch path.** `prompt_edit` keeps using
   `applyLinePatches` / `LinePatchSchema` from `src/fs/patches.ts` — the same
   surface used by `task_edit`, `schedule_edit`, `skill_edit`, `context_edit`.
6. **CRUD on both surfaces.** Agent tools: `prompt_list`, `prompt_read`,
   `prompt_create`, `prompt_edit`, `prompt_delete`. CLI: `botholomew prompts
   {list,show,create,edit,delete,validate}`. No TUI tab in this milestone.

## What this unblocks

- Users can ship project-specific prompts (e.g. a `style.md` for tone, a
  `runbook.md` for on-call) without learning anything beyond markdown.
- The agent can author its own prompts in chat — useful when it learns a new
  workflow nuance and wants to remember it past the current thread.
- Future tooling (TUI Prompts tab, sync, sharing) has a single, validated
  shape to target.

---

## Implementation

### 1. Strict schema (`src/utils/frontmatter.ts`)

Adds `PromptFrontmatterSchema`, `parsePromptFile`, `serializePromptFile`, and
`PromptValidationError` alongside the existing loose `parseContextFile` /
`serializeContextFile` (which keep serving `context/` files and the
`capabilities.md` writer where extra metadata like `source_url` and
`imported_at` lives).

```ts
export const PromptFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    loading: z.enum(["always", "contextual"]),
    "agent-modification": z.boolean(),
  })
  .strict();
```

`parsePromptFile(path, raw)` throws `PromptValidationError(path, reason)` on:

- Unparseable YAML.
- Missing frontmatter (`gray-matter` returned an empty `data`).
- Any Zod failure — missing field, wrong type, unknown key, empty title.

The error message always includes the file path so a worker log line names
the offending file.

### 2. Loud loader (`src/worker/prompt.ts`)

`loadPersistentContext` now lists `prompts/*.md`, sorts them, and parses each
with `parsePromptFile`. The only swallowed error is `ENOENT` on `prompts/`
itself (fresh working directory before `init`); everything else propagates.

`buildSystemPrompt` and `buildChatSystemPrompt` propagate too. `tick.ts`
wraps the call in a try/catch that flips the task to `failed` with the
validation message and returns cleanly — the worker keeps running for the
next task. Chat surfaces the error normally and stays alive so the user can
fix the file and retry.

### 3. Init refactor (`src/init/{templates,index}.ts`)

`SOUL_MD` deleted. `GOALS_MD` rewritten to:

- Add `title: Goals` frontmatter.
- Open with the soul identity prose.
- Append the existing goal bullets.
- Stay `loading: always`, `agent-modification: true` (so the agent can
  rewrite goals as they complete; the identity prose is now editable too,
  which matches the "no special files" framing).

`BELIEFS_MD` and `CAPABILITIES_MD` get `title:` fields. `init/index.ts` only
writes three files: `goals.md`, `beliefs.md`, `capabilities.md`. The
`writeCapabilitiesFile` rewrite preserves whatever title is on disk and
defaults to `Capabilities`.

### 4. Agent tools (`src/tools/prompt/`)

Five tools, all in the `context` group, all routed through `parsePromptFile`
for both pre- and post-write validation:

| Tool | Bash analog | Description |
|---|---|---|
| `prompt_list` | `ls` | Returns name, title, loading, agent_modification, size, and a `valid`/`error` pair per file. Bad files don't abort the list. |
| `prompt_read` | `cat` | Returns the raw file plus parsed metadata. On parse failure, returns `error_type: invalid_frontmatter` with the raw content so the agent can repair it. |
| `prompt_create` | `touch` | Builds frontmatter from arguments, validates round-trip, atomic-writes via rename. `on_conflict: 'error' \| 'overwrite'`. |
| `prompt_edit` | `patch` | Existing tool; switched from the loose parser to `parsePromptFile`. Pre- and post-patch refusals when `agent-modification: false`. Mtime-guarded atomic write. |
| `prompt_delete` | `rm` | Refuses files marked `agent-modification: false`. Malformed files can still be deleted (the agent must be able to clean up after itself). |

All tools sanitize names: `[a-zA-Z0-9._-]` only, no `..`, no slashes, no NUL.

### 5. CLI (`src/commands/prompts.ts`)

A new top-level `prompts` group with six subcommands. Highlights:

- `prompts list` — table of name / title / loading / editable / size / status,
  with broken files flagged in red without aborting the list. Supports
  `-l, --limit` and `-o, --offset`.
- `prompts create <name> [--title <s>] [--loading always|contextual]
  [--no-agent-modification] [--from-file <path|->] [--force]` — body comes
  from `--from-file` (`-` is stdin) or a default `# Title` skeleton.
- `prompts edit <name>` — opens `$EDITOR` (fallback `nano`) and re-validates
  on save. If validation fails, the user's edits are written to a
  `.tmp.invalid` sibling so they can recover them, and the original file is
  left untouched.
- `prompts delete <name> [--force]` — respects `agent-modification: false`
  unless `--force`.
- `prompts validate` — runs the strict parser over every `*.md` in
  `prompts/`, prints a per-file PASS/FAIL line, exits non-zero on any
  failure. Useful in CI and as a fast health check before starting a worker.

### 6. Docs

- `docs/prompts.md` rewritten around the generic-files framing. Documents the
  schema, the loud-fail behavior, both CRUD surfaces, and an upgrade note for
  pre-0.16 projects ("add `title:` to each prompt").
- `README.md` CLI table grows a `prompts` row; the layout diagram drops
  `soul.md` and explains the new framing.
- `CLAUDE.md`, `docs/architecture.md`, `docs/context-and-search.md`,
  `docs/getting-started.md`, `docs/configuration.md`, `src/constants.ts`,
  and `src/chat/usage.ts` all have their stale four-file references updated.

---

## Verification

- `bun run lint` clean (tsc + biome).
- `bun test` — full suite green; new coverage in
  `test/utils/frontmatter.test.ts` (Zod schema cases),
  `test/worker/prompt.test.ts` (loud-fail loader cases),
  `test/tools/prompt.test.ts` (list/create/delete plus the existing
  read/edit), and `test/init/index.test.ts` (no `soul.md`, all seeds pass
  strict validation).
- Manual smoke test:
  1. `init` writes `goals.md`, `beliefs.md`, `capabilities.md` (no
     `soul.md`).
  2. `prompts list` shows three rows.
  3. `prompts create scratch --loading contextual --from-file -` from stdin
     adds a fourth, with the right frontmatter on disk.
  4. Drop a `broken.md` with no frontmatter; `prompts validate` exits
     non-zero and names it; `prompts list` flags it `invalid` without
     aborting; the worker tick refuses with a clear error until it's
     removed.
  5. `prompts delete` respects `agent-modification: false` unless `--force`.

## Out of scope

- TUI Prompts tab (deferred — chat already exposes the agent CRUD tools).
- Auto-migrating existing `soul.md` files in user projects (they keep
  working as ordinary prompts; the upgrade note in `docs/prompts.md` covers
  the `title:` addition).
- Changing how `capabilities.md` is generated.
- Vector-store / semantic loading of prompts (`docs/prompts.md` already
  explains why this is intentional).
