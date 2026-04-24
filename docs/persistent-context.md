# Persistent context & agent self-modification

The `.botholomew/` directory contains a handful of markdown files that
shape how the agent thinks. Some the agent can rewrite; some it can't.
Every one is versioned by frontmatter.

---

## The default files

`botholomew init` creates:

| File | Loading | Agent-editable? | Purpose |
|---|---|---|---|
| `soul.md` | `always` | **no** | Identity — who the agent is, how it behaves |
| `beliefs.md` | `always` | yes | Priors the agent has learned about the world/project |
| `goals.md` | `always` | yes | Current goals; updated as goals complete or change |
| `capabilities.md` | `always` | yes | LLM-summarized, thematic inventory of what the agent can do (built-in + MCPX); no specific tool names |

Each uses YAML frontmatter to declare its behavior:

```yaml
---
loading: always          # or "contextual"
agent-modification: true # or false
---

# Beliefs

- I should be concise and clear in my work products.
- I should ask for help when I'm stuck rather than guessing.
```

---

## Loading modes

**`loading: always`** — the file is concatenated into every system
prompt, verbatim. Use sparingly. `soul.md`, `beliefs.md`, and `goals.md`
are always-loaded.

**`loading: contextual`** — the file is included only if its content
shares keywords with the caller's current intent. The daemon derives
keywords from the running task's name and description; the chat agent
derives them from your most recent message. Use this for
topic-specific notes ("Everything I know about our invoicing system")
that shouldn't pollute the prompt on unrelated tasks.

See `loadPersistentContext()` and `extractKeywords()` in
`src/daemon/prompt.ts`.

---

## Agent self-modification

When `agent-modification: true`, the agent can rewrite the file using
the `update_beliefs` or `update_goals` tools (`src/tools/context/`).
The flow:

1. Agent calls `update_beliefs` with the new full file content.
2. The tool reads the existing file, parses frontmatter with
   `gray-matter`, preserves the frontmatter block, and writes back the
   new body.
3. A `context_update` interaction is logged to the current thread, so
   you can see — and audit — every time the agent changed its own
   priors.

Files without `agent-modification: true` are read-only to the agent,
even if the tool is called — the tool checks the frontmatter and
refuses.

---

## `capabilities.md` — high-level tool inventory

`capabilities.md` is the same shape as `beliefs.md` / `goals.md`
(always-loaded, agent-editable), but its body is machine-generated
rather than hand-written. It's a **thematic summary** of what the
agent can do — built-in capabilities grouped into coarse themes (task
management, virtual filesystem, search, threads, …) and one theme per
external service reachable through MCPX (Gmail, GitHub, Linear, …).
Specific tool names are intentionally **omitted** from the rendered
file; the agent uses `mcp_list_tools`, `mcp_search`, or `mcp_info` to
look up exact names when it actually needs to invoke a tool. This
keeps the always-loaded context small (tens of lines instead of
hundreds).

Summarization uses Claude (the `chunker_model` from config) on every
refresh. When no Anthropic API key is configured, a static fallback
listing is rendered with internal themes + MCPX server names and tool
counts.

It's seeded at `botholomew init` with the built-in tools already
populated. Regenerate it any time via:

- `botholomew capabilities` — CLI refresh (honors `--no-mcp`)
- `capabilities_refresh` — the agent calls this tool itself when it
  suspects the inventory has drifted (new MCPX servers added, tools
  renamed, file deleted)
- `/capabilities` — the matching slash command in chat

Frontmatter is preserved on regeneration, so you can safely flip
`loading` to `contextual` if you'd rather only surface the file when
the task mentions tools.

---

## What this actually looks like

A typical `beliefs.md` after a few weeks of use:

```yaml
---
loading: always
agent-modification: true
---

# Beliefs

- Evan prefers bullet-point summaries over paragraphs.
- The "Q4 planning" doc in /notes is the canonical source for revenue targets.
- The daemon should escalate to a "waiting" status if a task needs access
  to a tool that isn't configured, instead of failing outright.
- When summarizing email, strip quoted replies — they add tokens without
  value.
```

None of those were in the seed template — they accumulated as the agent
worked tasks and the chat user confirmed them. That's the whole point:
the agent gets smarter about *your* workflow over time, and you can
read (and edit) exactly what it believes.

---

## Why not put this all in a vector store?

Beliefs and goals are high-priority, always-loaded text — they're what
the agent uses to decide *what to do*, not raw reference material. Burying
them in a vector index means the agent might not retrieve them when it
matters. Keeping them as flat markdown with a hard `always` flag makes
them impossible to miss.

Long-form reference material (ingested PDFs, web pages, meeting notes)
lives in the [context & embeddings system](context-and-search.md)
instead. The two are complementary:

- **Persistent context** = how the agent thinks.
- **Context items / embeddings** = what the agent knows.

---

## Adding your own

Drop any `.md` file into `.botholomew/` with frontmatter:

```yaml
---
loading: contextual
agent-modification: false
---

# Our deployment checklist

1. Bump version in package.json
2. Run bun test && bun run lint
3. ...
```

Tasks mentioning "deploy", "release", or "version" — and chat messages
mentioning the same — will now include this file in the system prompt
automatically. You didn't have to register it anywhere. On every tick
the daemon reads every `.md` file in `.botholomew/`, extracts words
longer than three characters from the current task's name and
description, and includes any `loading: contextual` file whose content
contains at least one of those words. The chat agent does the same on
every turn, using your most recent message as the keyword source. See
`loadPersistentContext()` in `src/daemon/prompt.ts` for the exact
logic.
