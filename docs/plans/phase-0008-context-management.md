# Phase 8 — Context management

> **Goal:** A conversation can run for months. It never hits the model's context limit mid-turn and never
> sends an orphaned tool result. Huge tool outputs stay out of context but one memory read away. A bot can
> recall what was said in any thread of its project, and the stable prefix of every request is paid for
> once.

> **Status: planned, not built.** Stage B — One bot that thinks. Depends on
> [phase 4](./phase-0004-project-memory-core.md), [phase 5](./phase-0005-bots.md),
> [phase 6](./phase-0006-durable-bot-loop.md), and [phase 7](./phase-0007-threads-and-web-chat.md).

[Phase 6](./phase-0006-durable-bot-loop.md) hydrates a conversation's whole transcript on every tick. That is
fine for a week and fatal for a leader bot that lives in a project's main thread. v1 runs into this and has
three answers, each of which this phase replaces:

- **Trimming.** [`fitToContextWindow`](https://github.com/evantahler/botholomew/blob/v1/src/worker/context.ts)
  drops messages one at a time from index 1. That can remove an assistant's tool call while keeping its
  result, which a provider rejects.
- **Truncation.** It cuts tool results to 50,000 characters in place.
- **Large results.** It parks large results in a process-global `lr_N` map
  ([`large-results.ts`](https://github.com/evantahler/botholomew/blob/v1/src/worker/large-results.ts)),
  cleared every loop and lost on every crash.

The replacements come from pi-durable and from v1's own field notes. Compaction runs in the background
against a token reserve. The summary lands at a turn boundary, and nothing is ever deleted. A reset starts a
fresh context from a handoff note. Big content is written to project memory, where it outlives the tick and
code mode can reduce it. Episodic recall is a search over threads, the 2.0 version of v1's `thread search`.

This phase does not build semantic search over threads: full-text search answers "what did we decide",
which is a question about facts. Code mode reading scratch files is
[phase 11](./phase-0011-code-mode.md). Ingesting a fetched URL into memory is
[phase 19](./phase-0019-url-ingest.md); a fetched URL's tool result is provenance-fenced here like any other
external result. Retention for transcripts and messages is [phase 18](./phase-0018-operations.md).

## Scope

**In:**

- Token accounting: per-entry estimates, calibrated against measured usage.
- The context-window table and a per-model override.
- The `reserveTokens` / `backgroundTokens` / `keepRecentTokens` thresholds.
- Background compaction:
  - a `conversation_compactions` staging table and a `conversation:compact` task;
  - application at turn boundaries;
  - blocking at the reserve line;
  - compact-and-retry-once on a too-long rejection;
  - a deterministic fallback when summarization fails.
- `reset` entries from three sources: `conversation:reset` (a person), the `context_handoff` tool (the bot),
  and the fallback.
- Safe cut points, so no tool result is ever orphaned.
- Large tool results offloaded to `scratch/conversations/<id>/…` in project memory, with a stub and preview,
  paged through `memory_cat`.
- `scratch/` excluded from default search and from embedding.
- The `scratch:sweep` clock.
- `thread_search` and `thread:search`, with CLI and web.
- Prompt-cache discipline across compactions, cache hit rate measured from `usage_events`, and a context
  meter.
- User docs and tests.

**Out:**

- Semantic (embedding) search over threads. Not scheduled; full-text search is the recall tool.
- Code mode over scratch files ([phase 11](./phase-0011-code-mode.md)).
- URL ingest into memory ([phase 19](./phase-0019-url-ingest.md)).
- Retention of `thread_messages` and `conversation_entries` ([phase 18](./phase-0018-operations.md)). This
  phase sweeps only `scratch/`.
- An extended (hour-long) prompt-cache TTL. Not scheduled; the hit rate this phase measures decides whether it is
  needed.
- v1's reflection loop. Not ported here.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| v1 context windows | `getMaxInputTokens`: an override, then `KNOWN_CONTEXT_WINDOWS`, then a per-provider fallback | [src/llm/capabilities.ts](https://github.com/evantahler/botholomew/blob/v1/src/llm/capabilities.ts) |
| v1 trimming | `CHARS_PER_TOKEN = 4`, `fitToContextWindow`'s `splice(1, 1)` (the orphaning bug), and in-place truncation | [src/worker/context.ts](https://github.com/evantahler/botholomew/blob/v1/src/worker/context.ts) |
| v1 large results | `MAX_INLINE_CHARS = 10_000`, the stub with a preview and a next-action hint, and the process-global store not to port | [src/worker/large-results.ts](https://github.com/evantahler/botholomew/blob/v1/src/worker/large-results.ts), [read_large_result.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/util/read_large_result.ts) |
| v1 thread search | The tool shape (pattern, role, since / until, hits with a sequence to read around), and the field note that makes it worth having | [src/tools/thread/search.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/thread/search.ts), [docs/field-notes.md](https://github.com/evantahler/botholomew/blob/v1/docs/field-notes.md) |
| v1 cache breakpoints | System plus last-assistant marking | [src/llm/cache-control.ts](https://github.com/evantahler/botholomew/blob/v1/src/llm/cache-control.ts) |
| membot reads | Line-based `offset` / `limit` on `read`, which `memory_cat` inherits | [src/operations/read.ts](https://github.com/evantahler/membot/blob/main/src/operations/read.ts) |
| pi-durable | `reserveTokens` (16,384) and `backgroundTokens` (32,768); the summary placed at the next turn boundary; compact-and-retry-once on a too-long rejection; `reset()` with a handoff; nothing deleted, so history stays searchable | [pi-durable](https://earendil.com/posts/pi-durable/) |
| Batched sweeps | Delete in batches so a purge never holds a long transaction | `toolexec:backend/actions/run/runs-sweep.ts` |
| Project memory | `MemoryOps.write` / `read`, reserved-path exclusion from default search, keyword search, the memory browser | [phase 4](./phase-0004-project-memory-core.md) |
| The loop | Entry kinds `compaction` and `reset`, `hydrate`, `assertWellFormed`, fencing, `usage_events`, the context-too-long error class, and the fake model server | [phase 6](./phase-0006-durable-bot-loop.md) |
| Thread UI | Thread page, turn log, bot chips, threads list | [phase 7](./phase-0007-threads-and-web-chat.md) |

## What this must not weaken

1. **The transcript is append-only.** Compaction and reset add entries. They never delete or edit one, and
   `conversation:view`, `thread_search`, and audit still see everything.
2. **No request carries an unmatched tool call or result.** Context shrinks only at safe cut points, and
   phase 6's well-formedness check stays the backstop.
3. **One writer per conversation.** The compaction worker holds no lease and writes no entries. Only the
   lease holder appends a `compaction` or `reset` entry, under the fence.
4. **Provenance survives summarization.** What came from fenced sources is summarized as an attributed
   report, never as an instruction.
5. **BYOK, and every token is accounted.** Summaries run on the project's own model. Their cost is a
   `usage_events` row and counts against budgets.
6. **The project is the boundary.** Scratch files are ordinary project memory, readable by members. Human
   thread search returns only threads the caller can read.
7. **Nothing volatile before the last cache breakpoint.**

## Design

### Counting tokens

Every entry stores a `tokenEstimate` (characters / 4, v1's heuristic) when it is written. Estimates drift:
code, JSON, and non-English text all tokenize differently. So the conversation also keeps ground truth.
After every model step, `contextTokens` is set to the request's measured input. That is fresh input plus
cache reads plus cache writes, from phase 6's normalized usage, and it includes tools and system. It is
stored with the `seq` it was measured at. The current size is then that measurement plus the estimates of
entries appended since. v1 estimates everything from characters and never corrects itself, so its trimming
is confidently wrong on JSON-heavy turns.

### How big the window is

`backend/llm/contextWindows.ts` ports v1's lookup. A `maxInputTokens` override on the model's registry
entry ([phase 5](./phase-0005-bots.md)) comes first, then the known-window table, then a per-provider
fallback: `anthropic` 200,000, `openai` 128,000, `openai_compatible` 32,000. v1's Ollama probe is not
ported. A test keeps the window table and phase 6's price table in step, so a model with a price always has
a window.

### Thresholds

```
0 ─────────────────── W − R − B ──────────────── W − R ──────────────── W
        normal          │ start a background summary │ next request waits │ provider limit
```

These are pi-durable's parameters, as project settings:

- **`W`** is the window.
- **`reserveTokens`** (R, default 16,384) is raised to the step's `maxOutputTokens` plus 4,096 when that is
  larger, because the reply has to fit too.
- **`backgroundTokens`** (B, default 32,768).
- **`keepRecentTokens`** (default 20,000) is the tail that is never summarized.

Settings are validated so that `R + B + keepRecent < W / 2` for every model a bot in the project may resolve
to. Otherwise compaction would run every few steps and summarize work the bot is still doing.

### Background compaction

1. **Request.** After a step's usage is recorded, if the context is past `W − R − B` and no compaction is in
   flight, the tick inserts a `conversation_compactions` row (`pending`). A partial unique index allows one
   in-flight row per conversation. `afterCommit` enqueues `conversation:compact` on queue `bots`.
2. **Choose the cut.** `coversThroughSeq` is the latest safe cut point at or before the position that leaves
   `keepRecentTokens` unsummarized. Turn boundaries are preferred over step boundaries (see
   [never orphan](#never-orphan-a-tool-result)).
3. **Summarize, outside the lease.** The task reads the previous summary and the entries after it, up to the
   cut, and asks the project's fast model for a new summary. The model comes from `resolveFastModel`, which
   falls back to the project's default ([phase 5](./phase-0005-bots.md)). The task writes the result to the staging row (`ready`), not to the transcript, and
   records `usage_events` with `kind: compaction`. Summaries roll: each one absorbs the previous one, so a
   conversation has exactly one live summary.
4. **Apply, under the lease.** At the next **turn boundary** the lease holder appends a `compaction` entry
   and marks the staging row `applied`, in one fenced transaction. The entry holds the summary,
   `coversThroughSeq`, the compaction id, the model, and the source and summary token counts. Waiting for a
   turn boundary (pi-durable's rule) keeps a summary from replacing context in the middle of work. It also
   means each application costs at most one cache miss per turn (see [caching](#prompt-cache-discipline)).
5. **Hydrate.** Find the latest `compaction` or `reset` entry. The model gets the system entry, a preamble
   rendered from that entry, and every entry with `seq > coversThroughSeq`, except `system`, `compaction`,
   and `reset` entries. That set includes the kept tail and anything written while the summary was being
   made, because the cut and the application are at different positions.

**When the reserve line is crossed first.** A step boundary past `W − R` blocks the next request:

- If a compaction is `running`, the tick waits for it, up to 90 s, renewing its lease.
- If none is running, the tick summarizes inline under its own lease and applies the result immediately.
  That is the one case where a summary lands mid-turn.

The preference stays background: a person waiting on a turn should not also wait on a summary. A provider
rejection classed as context-too-long (phase 6) triggers an inline compaction and **one** retry of the step.
A second rejection leaves the conversation `errored`, with a notice. Estimates can be wrong, and the
provider's answer is the one that counts.

### When compaction fails

A `running` row older than 120 s is failed by `bots:reap`, and a failed row is retried with backoff up to
three attempts. If the conversation is past the reserve line and every attempt has failed, the lease holder
applies a **deterministic fallback** so the conversation can still move:

- a `reset` entry at the latest safe cut, whose handoff is built without a model;
- the handoff lists the last five turns' opening messages and final replies;
- it ends: "Earlier conversation was not summarized; use `thread_search` or `thread_read` to recall it."

The thread gets a notice. A conversation is never stuck on a summarizer outage, and it is never trimmed by
deleting the middle.

### What a summary keeps

The summarizer gets no tools. It gets a fixed prompt asking for these sections, in this order:

- **Commitments**: what was promised, to whom, and by when.
- **Decisions**: what was decided, and who decided it.
- **Facts**: each with its source, such as a message id, a tool and call id, or a memory path.
- **Open work**: what remains, and what it is waiting on.
- **People and bots** involved.
- **Memory paths** written and read.
- **Pending wake-ups.**

v1's field notes say "facts beat vibes": a reflection loop that summarizes themes is not much use. A
summary is a working record, not an impression.

Fenced input stays fenced. Content that reached the conversation inside `<untrusted>` blocks is summarized
as attributed reports ("the GitHub tool reported …"). Any instruction found inside it is recorded as a
quoted claim from that source, never restated as a directive. When hydrated, the summary is rendered inside
`<conversation_summary covers="1–842">`. The fixed system section states that it is a record of earlier
conversation, not new instructions. Without that, a prompt injection in a tool result could be laundered by
the summarizer into trusted context.

### Reset and handoff

A `reset` entry holds a handoff note and `coversThroughSeq = seq − 1`. Hydration starts after it, with the
handoff as the preamble. Nothing before it is deleted. There are three writers:

- **A person**, with `conversation:reset` (audited, with an optional handoff). This is "start fresh" in the
  same thread, for when a conversation has gone sideways.
- **The bot**, with the `context_handoff` tool. This is pi-durable's tool-returned handoff, used when one
  stage of work is finished and its details would only crowd the next. The reset is appended at the next
  step boundary, after the tool's own result, so the call and its result are covered by the reset rather
  than split by it. At most one per turn.
- **The fallback** above.

### Never orphan a tool result

Phase 6 guarantees that a step's tool results immediately follow its assistant entry, and that steers and
events are appended only at step boundaries. Given that, a **safe cut point** is any position between
entries where every tool call before it has its result before it. In practice that is just before an
assistant entry that begins a step, or at a turn boundary. `safeCutPoints(entries)` enumerates them. It is
the only function that chooses where a summary or reset begins, and a property test over randomly generated
transcripts asserts that every suffix it allows is well-formed. v1's failure becomes a regression case: a
transcript where dropping index 1 orphans a result. Phase 6's `assertWellFormed` stays in front of every
request as the backstop.

### Large results live in memory

A tool result larger than `largeResultInlineChars` (10,000, v1's `MAX_INLINE_CHARS`) is written to project
memory. The path is `scratch/conversations/<conversationId>/<toolCallId>-<toolName>.<md|json|txt>`. It is
authored by the bot, with a change note naming the tool call. It is written **in the same transaction** as
the `tool_result` entry and the `tool_calls` outcome, because the offload is part of the outcome. A crash
leaves all three or none. This replaces phase 6's head-and-tail truncation.

Pages are lines, as in membot's `read`, so the file is normalized for paging:

- JSON is pretty-printed, and stays valid JSON for [code mode](./phase-0011-code-mode.md). v1 has to warn that
  its paged `lr_N` splits are not valid JSON.
- Other text has lines over 4,000 characters hard-wrapped, and the stub says so.

The model sees a stub:

```
[Result of github/list_issues (call 4812) saved to memory:
 scratch/conversations/77/4812-mcp_exec.json — 183,402 chars, 6,120 lines, application/json]

Preview (first 1,500 / last 500 chars):
…

Read it with memory_cat({ path, offset: 1, limit: 200 }), search it with
memory_search({ query, path_prefix: "scratch/conversations/77/" }).
```

When the result came from an external tool, the stub is fenced like the result itself.

**Memory instead of a process map.** A memory file outlives the tick, the process, and a deploy. Its id is
a path, not a process-global counter. A person can open it in the memory browser. Code mode can read it.
And it sits inside the same project boundary as everything else. `memory_cat` with `offset` / `limit` *is*
v1's `read_large_result`, so there is no separate paging tool. `memory_cat`'s own output cap
([phase 4](./phase-0004-project-memory-core.md)) keeps a single page from flooding the context again.

**Scratch is working state, not knowledge.** `scratch/` is excluded from default `memory_search` unless a
`path_prefix` names it, as reserved paths are. [Phase 9](./phase-0009-memory-search-and-ingestion.md)'s
chunker skips it, so the worker never spends CPU embedding a raw API dump.

**Retention.** The daily `scratch:sweep` hard-deletes, in batches, every scratch file that meets **both**
conditions:

- it is older than `scratchRetentionDays` (default 14);
- its tool call sits at or before the conversation's latest compaction or reset (`coversThroughSeq`), so it
  is out of live context.

Files of deleted conversations go too. A file still in live context is kept whatever its age, so a stub the
model can see never dangles. Reading a swept path returns `not_found`, with a hint that scratch results are
swept once out of context and that the original tool can be run again.

### `thread_search`: episodic recall

v1's field notes call thread search "nearly free" and handy: "what did we decide about that last week?"
becomes a real query. In 2.0 it is Postgres full-text search:

- **`thread_messages.searchVector`** is a generated `to_tsvector('english', body)` with a GIN index, covering
  every message in the project.
- **`conversation_entries.searchVector`** covers the bot's own transcript. It is generated from a
  `searchText` column extracted at insert from `user`, `assistant`, `compaction`, and `reset` entries.
  `tool_result` entries are excluded: large ones are already in scratch, and the rest are noise.
- Queries go through `websearch_to_tsquery`, so quotes, `OR`, and `-word` work, and no input can raise a
  syntax error.

| Surface | Scope | Notes |
|---|---|---|
| `thread_search` (bot tool) | `scope: "threads"` (default): every thread in the project; `scope: "mine"`: this bot's own entries across its conversations | Bots are not a security boundary, so a bot searches the whole project. Hits carry `thread_id`, `message_id`, title, author, time, and a `ts_headline` snippet, plus a hint to call `thread_read({ thread_id, before_id, limit: 5 })` around a hit. The output is fenced |
| `thread:search` (action) | Threads the caller can read, filtered in SQL so totals are true | Web search box, CLI, MCP |

**Full-text, not embeddings.** Recall questions are about names, numbers, and decisions, and exact words
find those. Embedding every message would put a model call on every post for a gain no one has measured.
[Phase 9](./phase-0009-memory-search-and-ingestion.md)'s embedder exists if that ever changes.

### Prompt-cache discipline

[Phase 6](./phase-0006-durable-bot-loop.md) sets the order. This phase keeps it true across compactions and
makes it measurable. On Anthropic there are three breakpoints, of the four allowed:

| Breakpoint | After | Changes when |
|---|---|---|
| 1 | tools + system | prompts, tool set, or model change (only at a turn boundary, with a new system entry) |
| 2 | the compaction / reset preamble | a compaction or reset is applied (normally at a turn boundary) |
| 3 | the previous step's last entry | every step |

The rules, each with a test:

1. Nothing before breakpoint 3 varies per request. There are no timestamps, request ids, or counters in the
   system prompt or the preamble.
2. Tools are sorted by name, and schema keys are serialized in a stable order.
3. Prompts are ordered by path. Keyword-matched `contextual` prompts live in the volatile tail.
4. The tool set, the prompts, and the summary change only at turn boundaries, except for the forced inline
   compaction.
5. The volatile tail is last.

OpenAI's automatic prefix caching rewards the same order without breakpoints.

**Measured, not assumed.** Phase 6's `usage_events` already separate fresh input, cache reads, and cache
writes, so a step's hit rate is `cacheRead / (fresh + cacheRead + cacheWrite)`. The rate is exposed in four
places:

- per step, in `conversation:view`;
- per bot, as a seven-day figure on the bot page, beside the compaction count;
- as a `bot_cache_hit_ratio` histogram;
- as a nightly eval assertion: a real multi-step turn reads at least 70% of its input from cache after its
  first step.

CI's fake model server cannot cache. CI instead asserts the precondition, byte-identical prefixes, and the
nightly harness asserts the outcome.

### The context meter

`conversation:view` returns `context: { windowTokens, usedTokens, backgroundLine, reserveLine,
compactions, lastCompactionAt }`. The thread page shows it as a small meter on each bot's chip, the bot
page's conversations card shows it, and `thread view --transcript` prints it. A person can see a summary
coming instead of being surprised by one.

## Steps

### 1. Schema — `backend/schema/{conversation_compactions,conversations,conversation_entries,thread_messages,tool_calls,usage_events}.ts`

| Table | Change | Notes |
|---|---|---|
| `conversation_compactions` | new: `projectId`, `conversationId` (cascade), `status` (`pending` \| `running` \| `ready` \| `applied` \| `failed` \| `superseded`), `fromSeq`, `coversThroughSeq`, `summary text`, `sourceTokens`, `summaryTokens`, `provider`, `model`, `attempts`, `error`, `startedAt`, `finishedAt`, `appliedEntryId` | partial unique `(conversationId)` where status in (`pending`, `running`, `ready`); `(status, startedAt)` for the reaper |
| `conversations` | `contextTokens`, `contextMeasuredAtSeq` | ground truth from the last step |
| `conversation_entries` | `searchText text`, `searchVector tsvector` (generated from `searchText`) | GIN on `searchVector`; `searchText` set at insert for `user` / `assistant` / `compaction` / `reset` |
| `thread_messages` | `searchVector tsvector` generated from `body` | GIN |
| `tool_calls` | `offloadPath text` | set when the result went to scratch |
| `usage_events` | `kind` gains `compaction` | — |
| `project_settings` | `compactionReserveTokens` (16 384), `compactionBackgroundTokens` (32 768), `compactionKeepRecentTokens` (20 000), `largeResultInlineChars` (10 000), `scratchRetentionDays` (14) | validated against every model the project's bots may resolve to |
| project model registry ([phase 5](./phase-0005-bots.md)) | `maxInputTokens` override, if that phase does not add it | — |

### 2. Config — `backend/config/context.ts`

`compactionWaitMs` 90 000, `compactionTimeoutMs` 120 000, `compactionMaxAttempts` 3, `previewHeadChars`
1 500, `previewTailChars` 500, `wrapLineChars` 4 000, `fallbackTurns` 5, `scratchSweepBatch` 500.

### 3. LLM boundary — `backend/llm/contextWindows.ts`

`getMaxInputTokens(resolved)` and the window table, ported from v1. Summarization calls go through the same
`getLanguageModel` and usage normalization as every other call.

### 4. Ops — `backend/ops/{ContextOps,CompactionOps,OffloadOps,ThreadSearchOps}.ts`

- `ContextOps`:
  - `measure(conversation)` returns `{ used, window, lines }`.
  - `safeCutPoints(entries)` returns positions.
  - `chooseCut(entries, keepRecentTokens)`.
- `CompactionOps`:
  - `requestCompaction(tx, conversation)`.
  - `runCompaction(compactionId)` is the task body. It never writes entries.
  - `applyCompaction(tx, lease, row)` and `fallbackReset(tx, lease)`.
  - `renderPreamble(entry)`.
- `OffloadOps`:
  - `offloadResult(tx, lease, toolCall, output)` returns `{ path, stub }`. It is called inside the outcome
    transaction.
  - `normalizeForPaging(output, mime)`.
- `ThreadSearchOps`: `searchThreads({ projectId, query, viewer, filters })` and
  `searchOwnEntries({ botId, query, filters })`.
- `EntryOps.hydrate` (changed): starts from the latest `compaction` / `reset`, as described above.

### 5. Actions and tasks — `backend/actions/{conversation,thread}/*.ts`

| Action / task | Route or schedule | RBAC | Audited | MCP |
|---|---|---|---|---|
| `conversation:reset` | `POST /conversation/reset` | member + `canWriteBot`; `handoff?` | yes | yes |
| `thread:search` | `GET /threads/search` | member; filtered by `canReadThread`; paginated | no | yes |
| `conversation:compact` | task-only, one-off, queue `bots` | — | no (machine) | never |
| `scratch:sweep` | task-only, daily, queue `default` | — | no (sweeper) | never |
| `bots:reap` (changed) | existing clock | — | no | never |

`bots:reap` gains one branch: it fails `running` compactions older than `compactionTimeoutMs` and schedules
their retry.

### 6. Bot tools — `backend/bots/tools/{thread-search,context-handoff}.ts`

| Tool | Description tag | Replay | Inputs | Notes |
|---|---|---|---|---|
| `thread_search` | `[[ bash equivalent command: grep -r ]]` | safe | `query`, `scope?` (`threads` \| `mine`), `thread_id?`, `author?`, `since?`, `until?`, `limit` (≤ 20) | Fenced hits, each with a `thread_read` hint; `input_error` with an example when the query is empty |
| `context_handoff` | — (no bash equivalent) | safe | `note` (≤ 4,000 chars) | Appends a `reset` at the next step boundary. A second call in the same turn returns `conflict` |

Large-result paging uses `memory_cat` and `memory_search` from [phase 4](./phase-0004-project-memory-core.md).
No new paging tool is added. The registry's prompt guidance for the memory group gains one paragraph on
scratch stubs, generated like the rest of the section.

### 7. Frontend — `frontend/src/{pages,components/threads,components/bots}/…`

- **Thread page:**
  - a context meter on each bot chip;
  - compactions and resets drawn as dividers in the turn log (*Earlier conversation summarized · view
    summary*);
  - **Start fresh** in a bot chip's menu, with an optional handoff note.
- **Threads page:** a search box with highlighted snippets. Each result links to `/threads/:id#m<messageId>`.
- **Bot page:** a seven-day cache hit rate and compaction count; the meter on the conversations card.
- **Memory browser** ([phase 4](./phase-0004-project-memory-core.md)): `scratch/` shown with a "working files,
  swept after 14 days out of context" note.

### 8. CLI — `cli/src/commands/{thread,conversation}.ts`

| Command | Action |
|---|---|
| `botholomew thread search <query> [--thread <id>] [--author <slug\|email>] [--since <date>] [--until <date>] [-l] [-o]` | `thread:search` |
| `botholomew conversation reset <id> [--handoff <text>]` | `conversation:reset` |
| `botholomew thread view <id> --transcript` (changed) | prints the context meter and compaction / reset markers |

Every command takes `--json`. Bumps `cli/package.json`.

### 9. User docs — `frontend/src/content/docs/{threads,bots,memory,cli,mcp}.md`

- **`threads.md`**: long conversations (summaries at turn boundaries, the meter, Start fresh), and searching
  threads.
- **`bots.md`**: how a bot handles big results (scratch files, paging) and recalls earlier conversations.
- **`memory.md`**: the `scratch/` namespace, its retention, and its exclusion from search.
- **`cli.md`**: `thread search` and `conversation reset`.
- **`mcp.md`**: `thread:search`.

### 10. Tests — `backend/__tests__/bots/*.test.ts`, `backend/__tests__/llm/*.test.ts`, `frontend/…`

`bots/compaction.test.ts`

- Crossing the background line enqueues exactly one compaction. A second crossing while it runs enqueues
  none (the partial unique index).
- The summary is applied at the next turn boundary, not mid-turn. Hydration afterwards contains the
  preamble plus every entry after `coversThroughSeq`, including those written during summarization. The
  earlier entries are still returned by `conversation:view`.
- **The worker writes no entries.** Entry counts and `seq` are unchanged by `conversation:compact` alone.
- **The reserve line blocks.** The fake server receives no step request until the summarization request has
  been answered. When none is running, the tick summarizes inline.
- **Too long.** A context-too-long rejection produces one inline compaction and one retry. A second
  rejection leaves the conversation `errored`.
- **Fallback.** Three summarizer failures past the reserve line produce a `reset` with the deterministic
  handoff and a notice, and the next request succeeds.
- **Provenance.** Fenced content reaches the summarizer fenced, and the applied summary reaches the model
  inside `<conversation_summary>`.

`bots/cut-points.test.ts`

- A property test over generated transcripts (steps with 0–4 tool calls, steers, events, gated calls):
  every suffix `safeCutPoints` allows passes `assertWellFormed`.
- The v1 regression: on the transcript where `splice(1, 1)` orphans a result, no allowed cut does.

`bots/offload.test.ts`

- **Offload.** A result over the threshold becomes a memory file at the expected path in the same
  transaction as its entry and outcome. With a fault before commit, neither exists; after commit, both do.
- The stub carries the path, sizes, preview, and the `memory_cat` hint. `memory_cat` with `offset` /
  `limit` pages through it.
- JSON offloads parse as JSON, and long lines are wrapped and flagged. An external result's stub is fenced.
- `scratch/` is absent from default `memory_search` and present with a `path_prefix`.
- A member can read the file through `memory:read`.
- **The sweep.** It deletes only out-of-context files past retention, in batches, and keeps an old file
  that is still in context. A swept path answers `not_found` with the re-run hint.

`bots/thread-search.test.ts`

- The tool finds a phrase across the project's threads, with a snippet and a `thread_read` hint, and its
  output is fenced.
- `scope: "mine"` returns only this bot's entries. Quoted phrases and `-word` work, and junk input returns
  hits or none, never a 500.
- **Human scope.** `thread:search` excludes threads the caller cannot read, from both rows and totals. It is
  published to MCP.

`bots/reset.test.ts`

- `conversation:reset` is audited, and the next hydration starts after it with the handoff.
- `context_handoff` appends its reset after its own result. A second call in the turn returns `conflict`.
- Content from before a reset is still found by `thread_search`.

`bots/cache-discipline.test.ts`

- After a compaction is applied, the request bytes through breakpoint 1 are identical to those before it.
  Breakpoint 2 sits at the end of the preamble.
- No timestamp appears before breakpoint 3. The tool set changes only at a turn boundary.
- The hit ratio computed from fixture usage carrying cache tokens matches the formula.

`llm/context-windows.test.ts`

- An override beats the table, and the table beats the provider fallback.
- Every model in the price table has a window.
- Settings that violate `R + B + keepRecent < W / 2` are refused with a sentence naming the model.

`frontend/src/__tests__/{context-meter,turn-log-dividers}.test.ts` — meter thresholds; dividers drawn for
`compaction` and `reset`. `frontend/e2e/threads.spec.ts` (extended) — a scripted long thread shows a
summary divider, and a question about its first message is answered after the bot calls `thread_search`.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

End to end, with a real connection whose model entry sets `maxInputTokens: 24000` so the thresholds arrive
quickly:

1. In a new thread, give the bot a codename in the first message, then chat until the meter passes the
   background line. A summary divider appears between turns, not inside one. The bot page counts one
   compaction.
2. Ask for the codename. The bot either has it from the summary or calls `thread_search`, and it answers
   correctly.
3. Have the bot call a tool that returns a large result (in tests, `test_external` with 200 KB). The
   transcript shows a stub, and the memory browser shows the file under `scratch/conversations/<id>/`. Ask
   for line 3,000. The bot pages with `memory_cat`.
4. `botholomew thread search "codename"` finds the first message. A member who cannot read this bot gets no
   hit.
5. Press **Start fresh** with the note "We're now working on the Q4 plan". The next turn's request starts
   from that note, and the meter drops.
6. After a few multi-step turns, the bot page's cache hit rate is well above zero.

Then the edge cases:

- **Kill the worker during a background summary.** The reaper fails the row and it is retried, and the
  conversation keeps working meanwhile.
- **Point the fast model at a dead endpoint.** After three attempts, past the reserve line, a fallback reset
  and a notice appear, and the conversation continues.
- **Run `scratch:sweep` with retention set to 0.** Files still in context survive. Files behind the last
  compaction are gone, and reading one returns the re-run hint.
- **Use a model whose window is smaller than the settings allow.** The settings are refused with the model
  named.

## Definition of done

- [ ] Token accounting calibrated by measured usage; `contextTokens` on conversations
- [ ] The window table with overrides and fallbacks; settings validated per model
- [ ] Background compaction through a staging row, applied at turn boundaries under the lease; blocking at the reserve line; inline compaction and one retry on a too-long rejection
- [ ] A deterministic fallback reset when summarization fails; no conversation stuck or trimmed
- [ ] Summaries keep commitments, decisions, sourced facts, and open work, and keep fenced content attributed
- [ ] `reset` from a person (`conversation:reset`), from the bot (`context_handoff`), and from the fallback; nothing deleted
- [ ] `safeCutPoints` as the only cut chooser, property-tested; the v1 orphaning case as a regression
- [ ] Large results in `scratch/conversations/<id>/` in the outcome transaction, with a stub and preview, paged by `memory_cat`; excluded from default search and embedding
- [ ] `scratch:sweep` that never deletes a file still in context
- [ ] `thread_search` (bot, project-wide, fenced) and `thread:search` (human, access-filtered), FTS with GIN indexes
- [ ] Cache breakpoints across compactions, prefix-stability tests, and a measured hit rate on the bot page and in the nightly evals
- [ ] The context meter in the API, web, and CLI
- [ ] CLI commands, user docs, and every test file above

## Commands

```bash
botholomew thread search "codename" --since 2026-10-01
botholomew conversation reset 77 --handoff "Q3 is done; we're on the Q4 plan now."
botholomew memory ls scratch/conversations/77/
botholomew memory read scratch/conversations/77/4812-mcp_exec.json

# By hand (ops CLI).
bun keryx.ts scratch:sweep
psql botholomew -c "select conversation_id, status, covers_through_seq, source_tokens, summary_tokens
                    from conversation_compactions order by id desc limit 10;"
```

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
