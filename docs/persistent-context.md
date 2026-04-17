# Persistent context & agent self-modification

The `.botholomew/` directory contains a handful of markdown files that
shape how the agent thinks. Some the agent can rewrite; some it can't.
Every one is versioned by frontmatter.

---

## The three default files

`botholomew init` creates:

| File | Loading | Agent-editable? | Purpose |
|---|---|---|---|
| `soul.md` | `always` | **no** | Identity — who the agent is, how it behaves |
| `beliefs.md` | `always` | yes | Priors the agent has learned about the world/project |
| `goals.md` | `always` | yes | Current goals; updated as goals complete or change |

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
shares keywords with the current task's name/description. Use this for
topic-specific notes ("Everything I know about our invoicing system")
that shouldn't pollute the prompt on unrelated tasks.

See `loadPersistentContext()` in `src/daemon/prompt.ts`.

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

Tasks mentioning "deploy", "release", or "version" will now include this
file in the system prompt automatically. You didn't have to register it
anywhere — on every tick the daemon reads every `.md` file in
`.botholomew/`, extracts words longer than three characters from the
task's name and description, and includes any `loading: contextual`
file whose content contains at least one of those words. See
`loadPersistentContext()` in `src/daemon/prompt.ts` for the exact
logic.
