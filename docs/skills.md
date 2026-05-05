# Skills (slash commands)

Skills are user-defined slash commands for the chat TUI. A skill is a
markdown file with frontmatter and a prompt template; when you type
`/<name>` in chat, the template is rendered and sent as a user message.

Think of them as reusable prompts — "summarize this conversation",
"review this file", "give me a standup update" — parameterized and
version-controlled alongside the project.

---

## File format

Skills live in `skills/<name>.md`:

```yaml
---
name: review
description: "Review a file for quality and issues"
arguments:
  - name: file
    description: "Path to the file to review"
    required: true
  - name: focus
    description: "What to focus on (security, performance, etc.)"
    required: false
    default: "general quality"
---

Please review the file at `$1`. Read it with the available tools, then provide:
1. A brief summary of what the file does
2. Any issues or concerns (bugs, security, performance)
3. Suggestions for improvement
4. An overall assessment (focus: $2)
```

**Frontmatter fields:**

| Field | Required? | Purpose |
|---|---|---|
| `name` | no | Defaults to filename. Determines the slash command name |
| `description` | yes | Shown in `/skills` listing and `/help` |
| `arguments` | no | Array of argument definitions (name, description, required, default) |

**Body:** Markdown prompt template with variable substitution.

---

## Variable substitution

| Placeholder | Meaning |
|---|---|
| `$ARGUMENTS` | The entire argument string as typed |
| `$1`, `$2`, … | Positional arguments (split on whitespace; single- and double-quoted strings are respected; the **last declared positional consumes the rest of the input**) |
| `$<name>` | Named placeholder bound to the declared argument with that `name` (same value as the matching positional `$N`) |

Missing optional arguments fall back to their `default`. Missing required
arguments cause a validation error before the skill is sent — the TUI
prints a `Usage:` line and never calls the LLM.

Named and positional placeholders refer to the same underlying value.
The `arguments[]` order in frontmatter sets each name's slot: the first
declared argument is `$1` and `$<first-name>`, the second is `$2` and
`$<second-name>`, and so on. Named placeholders are word-boundary
matched (so `$start` won't clip `$start_date`), and longer names are
substituted first when both exist.

Example:

```
> /review src/cli.ts security
```

becomes `$1 = $file = "src/cli.ts"`, `$2 = $focus = "security"`, and
`$ARGUMENTS = "src/cli.ts security"`.

### Multi-word arguments

The last declared positional argument is **greedy** — it captures the
entire remainder of the input verbatim. So a single-arg skill just
works without quoting:

```
> /summarize-topic why are avocados good?
```

→ `$1 = "why are avocados good?"` (one slot, full sentence).

For skills with two or more declared arguments, an unquoted multi-word
input is **ambiguous** — Botholomew can't know which words belong to
which slot. The TUI rejects the invocation, prints a parse breakdown,
and shows quoting suggestions instead of silently truncating:

```
> /write-as-evan why are avocados good?
/write-as-evan: ambiguous input. Parsed as:
  topic  = "why"
  format = "are avocados good?"

Quote the multi-word argument to confirm, e.g.:
  /write-as-evan "why are avocados good?"
  /write-as-evan 'why' 'are avocados good?'
```

Either single or double quotes work; the surrounding pair is stripped
when the entire remainder is one quoted run.

---

## Built-in defaults

`botholomew init` ships three skills out of the box:

**`summarize.md`** — summarize the current chat conversation.

**`standup.md`** — generate a standup update from recent tasks (completed
in the last 24h + in progress).

**`capabilities.md`** — rescan every built-in and MCPX tool and rewrite
`prompts/capabilities.md` (see
[prompts.md](prompts.md#capabilitiesmd--high-level-tool-inventory)).

More are easy to add; see the quickstart below.

---

## Invoking skills

From inside `botholomew chat`:

```
> /skills              # list all available skills
> /summarize           # run the summarize skill
> /review src/cli.ts   # positional argument becomes $1
```

### Autocomplete popup

Typing `/` at the start of the input pops up a menu of matching
commands (built-ins `/help`, `/skills`, `/clear`, `/exit` plus every
skill loaded from `skills/`). Each row shows the command
name and its description.

| Key | Action |
|---|---|
| `↑` / `↓` | Move the highlight |
| `Tab` or `Return` | Accept the highlighted command (fills in `/<name> ` so you can type arguments) |
| `Esc` | Close the popup without changing the input |

The popup filters as you keep typing, and it disappears once you type
a space — so a second `Return` submits the message as usual.

When a skill runs, the TUI's user bubble shows the literal slash command
you typed (e.g. `/review src/cli.ts security`), not the rendered prompt
body — that keeps the chat transcript readable. The agent still receives
the fully-rendered prompt as its user message.

---

## Managing skills from chat

Skills aren't write-once-via-CLI: the chat agent can list, read, create,
edit, search, and delete them on demand. Six tools are exposed to the chat
agent:

| Tool | What it does |
|---|---|
| `skill_list` | List skills (name, description, args, file path) |
| `skill_read` | Read a skill's raw file contents and parsed fields |
| `skill_search` | Keyword search across name, description, body, and arg metadata |
| `skill_write` | Create or overwrite a skill (`on_conflict: 'error' \| 'overwrite'`) |
| `skill_edit` | Apply git-style line-range patches to an existing skill |
| `skill_delete` | Delete a skill file by name |

Newly written or edited skills are picked up at the start of the *next*
user message — `ChatSession.skills` is reloaded from disk in
`sendMessage`. So a typical flow looks like:

```
> save this prompt as a skill called daily-log so I can run it tomorrow
[agent calls skill_write]
> /daily-log              # works immediately, no chat restart needed
```

`skill_write` rejects the reserved built-in names (`help`, `skills`,
`clear`, `exit`) with `error_type: "reserved_name"`. It also normalizes
names to `[a-z0-9-]`, sets the frontmatter `name` to match the
filename, and re-parses the generated file before writing — so an
invalid skill never lands on disk.

`skill_edit` re-parses after applying patches and refuses to write
if the result fails validation, so you can't break a skill from chat.

**Editing skills outside the chat** (e.g., with your text editor) still
requires a chat restart — the in-memory cache is only refreshed inside
`sendMessage`.

---

## CLI management

```bash
botholomew skill list                 # table of all skills (supports --limit / --offset)
botholomew skill show review          # print the full skill file
botholomew skill create daily-log     # scaffold a new skill
botholomew skill validate             # parse every skills/*.md and report errors
botholomew skill validate path.md     # validate a single file (handy before committing)
```

`skill show` exits non-zero if the name doesn't match a loaded skill, and
prints the available skill names to stderr. `skill validate` exits
non-zero if any file fails to parse, so it fits naturally into a
pre-commit hook or CI check.

Skills are parsed by `src/skills/parser.ts` and loaded from disk by
`src/skills/loader.ts`. The `ChatSession` caches them on session start
and reloads them at the top of every `sendMessage` — so skills the
chat agent creates or edits via the `skill_*` tools are usable on the
next user message. Direct file edits made outside the running chat
(e.g., from your editor) take effect on the next user message in any
active session, but won't appear retroactively in history.

---

## Writing a good skill

- **Be explicit about what you want.** The model doesn't know the shape
  of the output unless you describe it.
- **Use positional args, not free-form.** `/review src/cli.ts` is easier
  to tab-complete than `/review --file=src/cli.ts`. In the body, you
  can reference each argument either positionally (`$1`, `$2`) or by
  the name you gave it (`$file`, `$focus`) — pick whichever reads
  better.
- **Reference tools by name.** "Read the file with `context_read`" nudges
  the agent toward the right tool and keeps token counts down.
- **Keep them short.** A skill is a prompt, not a program. If your skill
  is 200 lines of conditional logic, it probably wants to be a real
  tool.

---

## Why not just type the prompt?

Because you'll type it a hundred times. Skills are pure convenience —
but they're also version-controllable, shareable (copy a `skills/`
directory between projects), and discoverable (`/skills` shows them all).
They turn "the prompt I always use for standup updates" into a durable
project asset.
