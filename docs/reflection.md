# Reflection (dream)

Botholomew accumulates conversations: every chat session and worker tick is
logged to a thread CSV under `threads/`. **Reflection** — "dreaming" — is the
step that turns those raw transcripts into durable memory. The agent reviews
its recent threads, distills the facts worth keeping into the
[knowledge store](files.md), and updates its own [prompts](prompts.md).

It's built entirely out of primitives that already exist — thread search,
the `membot_*` knowledge tools, and the `prompt_edit` self-modification tool —
so there's no new machinery to learn. Reflection just composes them on demand.

---

## Two ways to dream

### `/dream` (in chat)

`/dream` is a **built-in** chat command (like `/clear` or `/exit`), not a
user-editable skill. Type it in `botholomew chat` and the agent runs a
reflection pass inline, reviewing recent threads and proposing/applying
updates while you watch. Because it's built in, it always behaves the same way
and can't be silently broken by an edit.

### `botholomew dream` (CLI)

The CLI runs the same reflection pass non-interactively, so you can trigger it
by hand or on a schedule:

```bash
botholomew dream                 # review the last `dream_lookback_hours` (default 24h)
botholomew dream --since 7d      # review the last 7 days
botholomew dream --since 2026-06-01  # review since an ISO date
botholomew dream --dry-run       # propose edits without writing anything
```

| Flag | Meaning |
|---|---|
| `-s, --since <when>` | ISO date (`2026-06-01`) or relative duration (`24h`, `7d`). Defaults to `dream_lookback_hours`. |
| `--dry-run` | The agent reports what it *would* store and edit, but does not call `prompt_edit` or any knowledge-store write. |

Every run is logged to its own thread titled `Dream — <date>`, so reflections
are auditable: inspect one with `botholomew thread view <id>`.

---

## What a dream does

1. **Recall** — uses `list_threads` / `search_threads` / `view_thread` to find
   and read substantive recent conversations, scoped to the time window.
2. **Distill** — writes a concise reflection into the knowledge store at
   `reflections/<UTC-date>.md` and stores genuinely reusable facts under their
   natural `logical_path`. Reflections are namespaced and note their source
   project, so with a shared (`global`) store they don't blur together across
   projects.
3. **Self-edit** — reads `prompts/goals.md` / `prompts/beliefs.md` and applies
   small, justified updates with `prompt_edit`. Files marked
   `agent-modification: false` are refused and skipped.
4. **Report** — ends with an audit summary of what it reviewed, stored, and
   changed.

---

## Running it on a schedule

There's no built-in scheduler for reflection — run `botholomew dream` from
cron (or any of the [automation](automation.md) recipes). A nightly dream:

```cron
# Reflect every night at 3am, reviewing the last day of conversations.
0 3 * * *  cd /path/to/project && botholomew dream >> logs/dream.log 2>&1
```

Match the cadence to `dream_lookback_hours` so windows line up (a daily dream
pairs with the 24h default).

---

## Episodic memory: searching past threads

Reflection is how the agent *consolidates* memory; thread search is how it (and
you) *recall* it. The agent has `list_threads`, `search_threads`, and
`view_thread` tools, and the same search is available on the CLI:

```bash
botholomew thread search "duckdb"                 # regex / substring over all threads
botholomew thread search "deploy" --role user     # only user messages
botholomew thread search "error" --type worker_tick --since 2026-06-01
```

| Flag | Meaning |
|---|---|
| `--ignore-case` / `--no-ignore-case` | Case sensitivity (default: insensitive). |
| `-r, --role <role>` | Filter by `user` / `assistant` / `system` / `tool`. |
| `-t, --type <type>` | Filter by `chat_session` / `worker_tick`. |
| `--since <iso>` / `--until <iso>` | Restrict by thread start date. |
| `-l, --limit <n>` | Max hits to return. |

Each hit prints the thread id and the matching interaction's sequence number —
pass them to `botholomew thread view <id>` to read the surrounding context.

---

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `dream_lookback_hours` | `24` | Default recall window when `botholomew dream` is run without `--since`. |

See [configuration.md](configuration.md) for the full config reference.
