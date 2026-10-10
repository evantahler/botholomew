# Phase 12 — Skills

> **Goal:** A person types `/standup` — or any skill the project has written — in the web composer, picks it from
> an autocomplete popup with argument hints, and the rendered prompt is sent as their own message. Every bot,
> including workers running schedules and delegated tasks, sees the project's skills by name and description and
> loads one with `skill_read` when it applies. People manage skills in a form editor with history and diff.

> **Status: planned, not built.** Stage C — Shared capabilities. Depends on
> [phase 4](./phase-0004-project-memory-core.md) (`skills/` storage and the reserved-path validator),
> [phase 5](./phase-0005-bots.md) (system-prompt assembly), [phase 6](./phase-0006-durable-bot-loop.md) (bot tools),
> and [phase 7](./phase-0007-threads-and-web-chat.md) (the composer and message sending).

In v1 a skill was a markdown file in `skills/` that the chat TUI rendered and queued as a user message. It worked
well for the person at the keyboard and not at all for anyone else: rendering lived in the TUI's slash handler, so
background workers never saw a skill, and the only way a bot learned what skills existed was being told. In 2.0
skills are files in project memory from [phase 4](./phase-0004-project-memory-core.md) onwards — versioned,
searchable, editable in the memory browser — but nothing yet gives them behaviour. This phase does.

Two audiences get the same file. For people, a skill is a parameterized prompt invoked as a slash command; v1's
parser, argument rules, and ambiguity check come across nearly verbatim, with one substitution bug fixed. For
bots, a skill is a playbook: its name and description are listed in every bot's system prompt, and `skill_read`
loads the body on demand, so a worker bot that wakes for a schedule at 7 a.m. can follow the same "standup"
playbook a person would have typed.

Out of this phase: the TUI and Slack surfaces, which call the same actions later; skills that carry tool
permissions or code; and per-bot private skills.

## Scope

**In:** the v1 parser and renderer ported to `backend/skills/` (quote-aware tokenizer, greedy last argument, named
`$arg` longest-first with a word boundary, `$ARGUMENTS`, `$1`–`$9` with defaults, `validateSkillArgs`,
`detectAmbiguousSplit`) rendered in a single pass; the renderer's rules added to phase 4's `skills/` validator so a
file that saves is a file that renders; a closed reserved-name list served by the API; server-side `skill:render`
(dry run) and `skill:run` (send as the person); slash commands in the web composer with a popup, argument hints,
and a rendered preview; the skill roster in every bot's system prompt; the bot tools `skill_list`, `skill_read`,
`skill_write`, `skill_edit` with bash tags, writes gated by a project setting and audited as the bot; the Skills
page (form editor over frontmatter and body, live preview, history from memory); two starter skills;
`botholomew skill list|view|run`; user docs; tests.

**Out:** `botholomew chat` slash commands and tab completion, which are [phase 15](./phase-0015-tui-and-cli-publishing.md)
calling these actions; Slack's `/botholomew <skill>` with authorized linked identities only,
[phase 16](./phase-0016-slack.md); iMessage, [phase 17](./phase-0017-imessage.md). Skills that declare allowed tools,
carry code (use [code mode](./phase-0011-code-mode.md)), or install from a URL (membot's `skill install` is dropped)
are not planned. Per-bot skills under `bots/<slug>/` are not planned: a playbook only one bot uses belongs in that
bot's prompts. Scheduling a skill is [phase 14](./phase-0014-schedules-and-wakeups.md), whose schedules carry a
description that may invoke one.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| v1 parser | `tokenize`, `tokenizeForSkill` (greedy last argument, one matched pair of quotes stripped), `renderSkill`, `validateSkillArgs` | [src/skills/parser.ts](https://github.com/evantahler/botholomew/blob/v1/src/skills/parser.ts) |
| v1 slash handling | `formatSkillUsage`, `detectAmbiguousSplit` and its parse-breakdown hint, built-in commands, the `display` option that shows `/name args` instead of the rendered text | [src/skills/commands.ts](https://github.com/evantahler/botholomew/blob/v1/src/skills/commands.ts) |
| v1 loader and writer | Name normalization, `RESERVED_SKILL_NAMES`, the 64-character cap, `buildSkillFileContent` | [src/skills/loader.ts](https://github.com/evantahler/botholomew/blob/v1/src/skills/loader.ts), [src/skills/writer.ts](https://github.com/evantahler/botholomew/blob/v1/src/skills/writer.ts) |
| v1 skill tools | `skill_list`, `skill_read` (not-found lists available names), `skill_write` (`on_conflict`), `skill_edit` (line patches validated before write), plus `skill_search` and `skill_delete`, which are not ported | [src/tools/skill/](https://github.com/evantahler/botholomew/blob/v1/src/tools/skill/read.ts) ([write](https://github.com/evantahler/botholomew/blob/v1/src/tools/skill/write.ts), [edit](https://github.com/evantahler/botholomew/blob/v1/src/tools/skill/edit.ts), [list](https://github.com/evantahler/botholomew/blob/v1/src/tools/skill/list.ts)) |
| v1 tests | The parser's behaviour, case by case — ported as the renderer's regression suite | [test/skills/parser.test.ts](https://github.com/evantahler/botholomew/blob/v1/test/skills/parser.test.ts), [test/skills/commands.test.ts](https://github.com/evantahler/botholomew/blob/v1/test/skills/commands.test.ts) |
| v1 popup | The slash popup's interaction model: filter as you type, arrow keys, Tab or Return to accept, Esc to close | [src/tui/components/SlashCommandPopup.tsx](https://github.com/evantahler/botholomew/blob/v1/src/tui/components/SlashCommandPopup.tsx) |
| v1 starter skills | `summarize`, `standup`, `capabilities` seeded by `init` | [src/init/templates.ts](https://github.com/evantahler/botholomew/blob/v1/src/init/templates.ts) |
| v1 docs | File format, substitution table, multi-word arguments | [docs/skills.md](https://github.com/evantahler/botholomew/blob/v1/docs/skills.md), [milestone-7-skills.md](https://github.com/evantahler/botholomew/blob/v1/docs/plans/milestone-7-skills.md) |
| Project memory | `skills/<name>.md` storage, strict frontmatter on write, versions, diff, restore, the markdown editor, `project:<id>:memory` frames, `LinePatchSchema` | [phase 4](./phase-0004-project-memory-core.md) |
| Messages | Attributed human messages with `requestId`, owner and `@mention` routing, the composer | [phase 7](./phase-0007-threads-and-web-chat.md) |
| Audit for bot changes | `audit_logs.actorBotId` and `onBehalfOfUserId` | [phase 1](./phase-0001-clean-slate-and-shell.md) |

What does not exist: a renderer outside a terminal, any way for a bot to know a skill exists, and any record of
which version of a skill produced a message.

## What this must not weaken

1. **A skill is a file in project memory.** One store, versioned, diffable, restorable; there is no `skills` table.
2. **A file that saves is a file that renders.** Anything detectable at save time is refused at save time, with a
   hint; invocation never fails for a reason the validator could have caught.
3. **Invoking a skill is the person speaking.** The message is theirs — attributed, routed, deduplicated, and
   audited exactly as if typed — and carries no authority they lack.
4. **One renderer.** Rendering happens on the server; every surface calls it; no client re-implements it.
5. **A skill is text, not authority.** Loading one grants a bot no tool, server, or approval it did not already have.
6. **Bots write skills only where the project allows**, and every such write is audited with `actorBotId`.
7. **The system prompt stays cache-stable.** The skill roster changes only when a skill's name or description does.

## Design

### The file, and the rules that make it renderable

```yaml
---
name: review                     # equals the file stem: skills/review.md
description: Review a file in project memory for quality and issues
arguments:
  - name: path
    description: Logical path of the file
    required: true
  - name: focus
    description: What to look at
    default: general quality
---
Read `$path` with memory_cat, then report issues, focusing on $focus.
```

Phase 4 registers the `skills/` validator for the frontmatter's shape; this phase adds the rules the renderer
depends on, in the same validator: `name` matches `^[a-z0-9][a-z0-9-]{0,63}$`, equals the file stem, and is not
reserved; files live directly under `skills/` (no nesting); `description` is required and at most 200
characters, because it is in every bot's prompt; at most nine arguments, since `$1`–`$9` are the positional
slots; argument names match `^[A-Za-z_][A-Za-z0-9_]*$`, are unique, and are not `ARGUMENTS`; `required: true`
with a `default` is refused as a contradiction (v1 accepted it and silently treated the argument as optional); and
the body is non-empty. Each refusal is a PATs hint naming the field.

### The renderer, ported with one fix

v1's behaviour is kept: the quote-aware tokenizer; the greedy last argument, so `/write-as-evan why are avocados
good?` puts the whole sentence in `$1`; named `$arg` placeholders longest-first with a word-boundary tail, so
`$start` cannot clip `$start_date`; `$ARGUMENTS` as the raw input; `$1`–`$9` with defaults; required-argument
validation with a usage line; and `detectAmbiguousSplit`, which refuses an unquoted multi-word tail on a
multi-argument skill and shows the parse breakdown with quoting suggestions.

The fix: v1 substituted in passes — named arguments, then `$ARGUMENTS`, then digits — over the partially rendered
string, so a value containing `$2` or `$ARGUMENTS` was expanded again, and `$10` rendered as the first argument
followed by `0`. The 2.0 renderer scans the template once, left to right; each placeholder resolves from the
template alone and inserted values are never rescanned. `$1`–`$9` match only when not followed by another digit,
and `$$` renders a literal `$`, which v1 could not express (v1 rendered "costs $5" as "costs "). Every v1
parser test ports unchanged except the cases this fix deliberately changes.

### Rendering happens on the server

`skill:render` renders a stored skill — or a draft passed inline, for the editor's preview — and returns the text,
missing arguments with the usage line, or the ambiguity breakdown. `skill:run` renders and sends. Server-side
rendering is what lets the message record the exact `versionId` that produced it, keeps the web composer, the CLI,
the TUI, and Slack identical, and respects ToolExec's lesson that the frontend can import backend types but not
backend values. The composer calls `skill:render` debounced as arguments are typed, so the preview is the real
rendering, not a client approximation.

### Invoking a skill is sending a message

`skill:run` hands the rendered text to [phase 7](./phase-0007-threads-and-web-chat.md)'s message path with the
caller as author. Everything a typed message gets, it gets: the caller must have write on the receiving bot,
routing reads the rendered text exactly as if typed (an `@mention` in a skill body routes; the preview shows the
recipients before sending), the `requestId` makes retries exactly-once, and attribution and audit are
`message:send`'s. Without a thread it starts one with the chosen bot, as `message:send` does. The message's
`metadata.skill` holds `{ name, versionId, args }`, and the transcript shows `/review notes/q3.md security` as a
chip that expands to the rendered prompt — v1's `display` option, kept as data rather than a TUI trick. The bot's
conversation receives the rendered text: from the bot's side, the person said it.

### Built-in commands and reserved names

The web composer's built-ins are `/help` (commands and skills), `/skills` (the list), and `/new` (a new thread
with the current bot). `RESERVED_SKILL_NAMES` is the union of every surface's built-ins plus a margin: `help`,
`skills`, `new`, `clear`, `exit`, `quit`, `steer`, `queue`, `model`, `bot`, `approve`, `deny`. Reserving early is
cheaper than renaming somebody's skill after a later surface claims its name. The list lives in
`backend/skills/reserved.ts`, is served by `skill:list` so no client restates it, and a test asserts each
surface's built-ins are a subset. v1's `/dream` is not a built-in: reflection becomes an optional schedule in
[phase 14](./phase-0014-schedules-and-wakeups.md).

### Bots discover skills, then load them

Phase 5's prompt assembly gains a skills section: one line per skill, `name — description`, sorted by name, at
most 50 lines, then "N more; use skill_list". It sits in the cache-stable prefix and changes only when a name or
description does. A bot that judges a skill relevant calls `skill_read`, which returns the body, the argument
definitions, the `versionId`, and the author; given `args`, it also returns the rendering or the same validation
errors a person would see. The `versionId` a bot read is recorded on the call, beside the prompt versions
[phase 5](./phase-0005-bots.md) records, so "which playbook did it follow" is answerable.

Skill bodies are not provenance-fenced. They are project-authored instructions, trusted like prompts — which is
exactly why bot writes are off by default: a skill written by a bot from content it read elsewhere would be a
persisted injection every bot then trusts.

### Bot writes are a project decision

`skill_write` and `skill_edit` exist for every bot and refuse with a `policy_error` naming the setting unless the
project's `botsMayWriteSkills` is on (default off, admin-only). When on, writes go through `MemoryOps` as the
bot — the validator, `authorBotId`, a required change note — and are audited with `actorBotId` and
`onBehalfOfUserId` (the person whose message started the turn, when there is one). `skill_edit` applies
`LinePatchSchema` patches against the version it read and validates the result before writing, as v1 did. People
write skills under phase 4's memory rules for `skills/`; there are no skill-specific write actions, so there is
one write path and one validator. Bots have no delete tool; people delete in the Skills page or with
`botholomew memory rm`.

### Starter skills

v1 seeded `summarize`, `standup`, and `capabilities`. 2.0 seeds two at project bootstrap, authored by the
project's creator with the change note "starter skill": `summarize` (summarize this thread: decisions, open
items) and `standup` (what the bots did in the last 24 hours, from `thread_search` and `thread_read`, with what is
waiting on a person). `capabilities` is dropped: its job was refreshing a generated tool inventory, and 2.0's
tool lists are generated from the registry on every prompt. Projects created before this phase are not
backfilled; the Skills page offers "Add starter skills". Seeding is worth its clutter because an empty popup
teaches nobody what a skill is — v1 milestone 7's argument, still true.

### The Skills page

A list with name, description, argument usage, last author, and last change; a form editor over the frontmatter
(name fixed after creation — renaming is a memory `mv`; description; an arguments table with add, remove,
reorder, required, and default) and the body in phase 4's markdown editor; a preview pane with an arguments box
rendering the unsaved draft through `skill:render`; a raw toggle into the whole file; and history, diff, and
restore from the memory viewer. Saving writes a new version with a change note and `expectedVersionId`. "Try it"
opens the composer with the command filled in.

## Decisions so far

| Question | Decision |
|---|---|
| Where rendering happens | Server only: `skill:render`, `skill:run` |
| Substitution | Single pass; `$$` escapes; `$1`–`$9` not followed by a digit |
| `required` with `default` | Refused at save |
| Reserved names | `help`, `skills`, `new`, `clear`, `exit`, `quit`, `steer`, `queue`, `model`, `bot`, `approve`, `deny` |
| Roster size in the system prompt | 50 lines, sorted, then a pointer to `skill_list` |
| `skill_search`, `skill_delete` | Not ported: the roster lists every name and description, `memory_search` with `path_prefix: "skills/"` searches bodies, and deletion is for people |
| Bot writes | Off by default; admin-controlled `botsMayWriteSkills` |
| Starter skills | Seed `summarize` and `standup`; drop `capabilities`; no backfill |

## Steps

### 1. Schema — no new tables

Project settings gain `botsMayWriteSkills boolean default false`. `thread_messages.metadata` carries
`skill: { name, versionId, args }`. Skill files are `memory_files` rows under `skills/`.

### 2. Ops — `backend/skills/{tokenize,render,validate,reserved}.ts`, `backend/ops/SkillOps.ts`

- `tokenize` / `tokenizeForSkill`, `renderSkill` (single pass), `validateSkillArgs`, `detectAmbiguousSplit`,
  `formatSkillUsage` — pure, ported from v1, no Keryx imports.
- `validate` — `validateSkillFile(frontmatter, body, path)`, registered with phase 4's validator for `skills/`.
- `SkillOps` — `listSkills(projectId, {limit, offset})` (current versions, sorted), `getSkill(name)`,
  `render(skill, rawArgs)`, `run(tx, caller, {name, args, threadId?, botId?, requestId})` → phase 7's
  `sendMessage`, `skillRoster(projectId)` for prompt assembly, `seedStarterSkills(tx, projectId, userId)`.

### 3. Actions — `backend/actions/skill/*.ts`

| Action | Route | RBAC | Audited | MCP |
|---|---|---|---|---|
| `skill:list` | `GET /skills` (paginated; includes `reserved`) | member | — | yes |
| `skill:view` | `GET /skill` (`name`, `versionId?`) | member | — | yes |
| `skill:render` | `POST /skill/render` (`name` or inline `draft`, `args`) | member | no — writes nothing | yes |
| `skill:run` | `PUT /skill/run` (`name`, `args`, `threadId` or `botId`, `requestId`) | member with write on the receiving bot | as `message:send` | yes — Claude Desktop can run a skill as it can send a message |
| `skill:seed-starters` | `PUT /skill/starters` | admin | yes | yes |

Creating, editing, renaming, and deleting skills are memory actions; the validator makes them safe.

### 4. Bot tools — `backend/bots/tools/skill/{list,read,write,edit}.ts`

| Tool | Description tag | Replay | Inputs |
|---|---|---|---|
| `skill_list` | `[[ bash equivalent command: ls skills/ ]]` | safe | `limit?`, `offset?` → name, description, usage |
| `skill_read` | `[[ bash equivalent command: cat skills/<name>.md ]]` | safe | `name`, `args?` → body, arguments, `version_id`, author, `rendered?`; not-found lists available names |
| `skill_write` | `[[ bash equivalent command: tee skills/<name>.md ]]` | safe — whole-file, same bytes on replay | `name`, `description`, `arguments?`, `body`, `on_conflict?` (`error` \| `overwrite`), `change_note` |
| `skill_edit` | `[[ bash equivalent command: patch skills/<name>.md ]]` | unsafe — a replayed patch would apply twice | `name`, `patches` (`LinePatchSchema`), `change_note` |

### 5. Frontend — `frontend/src/components/chat/SlashCommandPopup.tsx`, `frontend/src/pages/SkillsPage.tsx`

The composer opens the popup on a leading `/`: built-ins then skills, filtered as typed, arrows and Tab to
complete, the usage line under the input, and the rendered preview (with recipients) above Send; missing
arguments and ambiguity disable Send and show the hint. The skill list stays live on `project:<id>:memory`
frames. `SkillsPage` and its editor as designed above; skill chips in the transcript expand to the rendered text
and link to the version.

### 6. CLI — `cli/src/commands/skill.ts`

| Command | Wraps |
|---|---|
| `botholomew skill list [-l] [-o]` | `skill:list` |
| `botholomew skill view <name> [--version <id>] [--raw]` | `skill:view` |
| `botholomew skill run <name> [args…] [--thread <id> \| --bot <slug>] [--dry-run]` | `skill:run`; `--dry-run` is `skill:render` |

Editing from a terminal is `botholomew memory edit skills/<name>.md` or `memory pull skills/ ./skills`.

### 7. User docs — `frontend/src/content/docs/skills.md`

The file format, the substitution table (with `$$` and the single-pass rule), quoting and the ambiguity check,
built-ins and reserved names, how bots discover and read skills, the bot-write setting, and the CLI. Update
`cli.md`, `memory.md` (the reserved path), and `bots.md` (what a bot's prompt lists).

### 8. Tests — `backend/__tests__/`

- `skills/render.test.ts` — v1's parser and commands cases ported; a value containing `$2` or `$ARGUMENTS` is not
  re-expanded; `$10` stays literal; `$$` renders `$`; longest-first and boundary; greedy last argument with and
  without quotes; defaults; ambiguity breakdown.
- `actions/skill.test.ts` — through `memory:write`: bad argument name, ten arguments, `required` with `default`,
  a reserved name, a name that differs from the stem, and a nested path are each refused with the field named;
  `skill:render` returns usage for missing arguments; `skill:run` posts a message attributed to the caller with
  `metadata.skill.versionId`, routes an `@mention` in the body, deduplicates by `requestId`, and returns 403 for a
  member without write on the bot; read actions are MCP-published.
- `bots/skill-tools.test.ts` — the roster is sorted, capped at 50, and byte-identical across two turns with no
  skill change; a worker bot in a delegated thread reads a skill; `skill_write` is refused with the setting off;
  with it on, the version is authored by the bot and the audit row carries `actorBotId` and `onBehalfOfUserId`;
  a `skill_edit` that breaks frontmatter writes nothing.
- `actions/project.test.ts` (extended) — bootstrap seeds `summarize` and `standup`; `skill:seed-starters` is
  idempotent.
- `frontend/e2e/skills.spec.ts` — type `/st`, pick `standup`, see the preview, send; the chip appears and the bot
  answers; create a skill on the Skills page in another tab and it appears in the popup without a reload.
- `cli/__tests__/skill.test.ts` — `skill run --dry-run` prints the rendering; `skill list` paginates.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, in the browser:

1. In a new project, open Skills: `summarize` and `standup` are there. Create `review` from the example above; the
   preview renders as you fill the arguments box.
2. In a thread with the leader, type `/rev`, Tab, then `notes/q3.md security`. The preview shows the rendering and
   the recipient; send. The transcript shows the chip; the bot follows the skill.
3. Type `/review notes q3 security` (unquoted, ambiguous): Send is disabled and the breakdown suggests quoting.
4. Ask a worker bot, in a delegated thread, to "do the standup". It calls `skill_read("standup")` — visible in the
   transcript — and follows it.
5. Edit `review` and diff it against the previous version in the memory viewer; restore the old one.

Then the edge cases:

- Save a skill named `help`, or with `required: true` and a `default`: refused, with the field named.
- An argument value containing `$1` renders literally.
- With `botsMayWriteSkills` off, asking a bot to write a skill yields the setting's name in its reply; turn it on and
  the new version appears with the bot as author and an audit row.
- `botholomew skill run standup --bot botholomew` from a terminal posts the same message the composer would.

## Definition of done

- [ ] Renderer ported to `backend/skills/`, single-pass, with v1's tests passing
- [ ] Renderer rules enforced by the `skills/` validator at write time
- [ ] `RESERVED_SKILL_NAMES` served by the API, with the subset test
- [ ] `skill:list`, `skill:view`, `skill:render`, `skill:run`, `skill:seed-starters`
- [ ] Slash popup with usage, preview, recipients, and blocking validation in the web composer
- [ ] Skill roster in every bot's system prompt, sorted and capped; `skill_read` records the version read
- [ ] `skill_list`, `skill_read`, `skill_write`, `skill_edit`; writes gated by `botsMayWriteSkills` and audited as the bot
- [ ] Skills page with form editor, live preview, and history from memory
- [ ] Starter skills seeded at bootstrap
- [ ] `botholomew skill list|view|run`, user docs, and the tests above, passing twice consecutively

## Commands

```bash
botholomew skill list
botholomew skill view standup --raw
botholomew skill run review notes/q3.md security --bot botholomew --dry-run
botholomew memory edit skills/review.md
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then the plan
above is the only account.
