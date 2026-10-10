# Phase 7 — Threads and web chat

> **Goal:** People talk to their bots in the browser. The project home shows every bot's live status and the
> threads in motion; a thread page streams the bot's reply as it is written and folds its tool work away;
> `@mentions` bring another bot in; a bell says when a bot needs you. `botholomew thread follow` does the
> same in a terminal.

> **Status: planned, not built.** Stage B — One bot that thinks. Depends on
> [phase 1](./phase-0001-clean-slate-and-shell.md), [phase 5](./phase-0005-bots.md), and
> [phase 6](./phase-0006-durable-bot-loop.md).

[Phase 6](./phase-0006-durable-bot-loop.md) made a bot think, durably, but a person can only reach it through
the CLI or an MCP client, every message goes to the thread's owner, and nothing tells a browser that anything
happened. This phase makes the thread the product surface. Three things change: **who hears a message**
(owner routing, mentions, participants), **how a client learns something happened** (channels, a token
stream, notifications), and **what a person sees** (the chat page, the composer, the project home, the bell).

The loop itself does not change. Every routing decision here produces the same `conversation_inbox` rows
phase 6 consumes, every frame is published by phase 6's `ThreadChannelOps` after commit, and every page still
hydrates over HTTP — the socket only decides *when* to ask, which is the lesson of ToolExec's
dashboard-websockets phase (`toolexec:docs/plans/phase-18-dashboard-websockets.md`) carried over intact.

It deliberately leaves out the terminal chat client ([phase 15](./phase-0015-tui-and-cli-publishing.md)), slash
commands and their popup ([phase 12](./phase-0012-skills.md)), thread search ([phase 8](./phase-0008-context-management.md)),
approval policy ("always allow") ([phase 10](./phase-0010-mcp-servers-and-approvals.md)), delegation threads
([phase 13](./phase-0013-leader-and-workers.md)), and anything outside the browser and CLI
([phase 16](./phase-0016-slack.md), [phase 17](./phase-0017-imessage.md)).

## Scope

**In:** routing — owner by default, `@bot`, `@everyone`, reply-to, and person mentions that notify;
participants (auto-join on mention, add, remove) and owner transfer; the visibility rule for every thread
kind; `thread:list`, `thread:edit`, `thread:participant-add` / `-remove`, `thread:mark-read`,
`project:overview`, and `message:send`'s routing fields; generated thread titles; the
`project:<id>:threads`, `…:thread:<id>`, `…:thread:<id>:stream`, `…:bot:<id>`, and `…:notifications`
channels with their `authorize()` checks; the `LiveSocketContext` port; the `notifications` table,
`notifications:dispatch`, `notifications:sweep`, the bell and toasts; the thread list, thread page (message
list, folded turn transcript, live stream, inline gated calls, status chips, queue / steer / stop composer),
and project home; CLI `thread list / follow / rename / owner / participants` and `notification list / read`;
MCP publication; user docs; tests including channel authorization and MCP forwarding.

**Out:**
- The Ink TUI ([phase 15](./phase-0015-tui-and-cli-publishing.md)); slash commands and the composer popup
  ([phase 12](./phase-0012-skills.md)); thread and episodic search ([phase 8](./phase-0008-context-management.md)).
- "Always allow" and approval history ([phase 10](./phase-0010-mcp-servers-and-approvals.md)) — this phase
  renders phase 6's gated tool calls inline with Approve / Deny only.
- `delegation` threads and task reports ([phase 13](./phase-0013-leader-and-workers.md)).
- Email notifications. Phase 1 drops nodemailer with the rest of ToolExec's mail stack; the out-of-app
  channels are Slack and iMessage DMs ([phase 16](./phase-0016-slack.md), [phase 17](./phase-0017-imessage.md)),
  added as new `notifications.channel` values.
- Editing, withdrawing, or reordering a queued message; archiving threads. Not scheduled.
- Private threads. Never in this plan; the [README](./README.md#roadmap) lists audience-scoped memory as
  later, unphased.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| Dashboard WebSockets | Content-free frames, "subscribe, then hydrate", reconnect re-reads, `pendingKinds` coalescing, `loadSeq` generations, the Keryx frame-ordering defect and the microtask workaround for remounts | `toolexec:docs/plans/phase-18-dashboard-websockets.md` |
| `LiveSocketProvider`, `useLiveChannel`, `useLiveReconnect`, `createChannelRegistry` | One reconnecting socket multiplexing every channel | `toolexec:frontend/src/context/LiveSocketContext.tsx` |
| Channel classes | `ChannelMiddleware.runBefore` for membership, `authorize()` for the per-subject read check; both halves of a refusal tested | `toolexec:backend/channels/projectRun.ts`, `toolexec:backend/channels/projectNotifications.ts`, `toolexec:backend/__tests__/channels/project-run.test.ts` |
| `RunChannelOps` | The never-throwing, content-free publisher and the per-subject vs. list-channel split | `toolexec:backend/ops/RunChannelOps.ts` |
| Notifications | The table, `enqueueNotification` in the caller's transaction, `notifications:dispatch` / `:sweep`, session-scoped read actions, `mark-read` never MCP, recipients never routed around `accessRead` | `toolexec:backend/schema/notifications.ts`, `toolexec:backend/ops/NotificationOps.ts`, `toolexec:backend/actions/notification/`, `toolexec:docs/plans/phase-12-human-help.md` |
| Bell and toasts | `NotificationProvider` as a channel subscriber, the bell, toasts, Web Notifications only from a click | `toolexec:frontend/src/context/NotificationContext.tsx`, `toolexec:frontend/src/components/NotificationBell.tsx`, `toolexec:frontend/src/components/NotificationToasts.tsx` |
| Transcript rendering | The log grid, call/result pairing, in-memory previews, `MarkdownBlock` only, no `role="log"`, stick-to-bottom from geometry, and the argued verdict against chat kits | `toolexec:frontend/src/components/RunTranscript.tsx`, `toolexec:frontend/src/utils/transcript.ts`, `toolexec:frontend/src/utils/transcriptChat.ts`, `toolexec:frontend/src/hooks/useStickToBottom.ts`, `toolexec:docs/TRANSCRIPT_UI.md` |
| Composer state | A pure function deciding whether Send / Steer are offered and the sentence under the field | `toolexec:frontend/src/utils/runFollowUp.ts` |
| Project home | One composed overview action feeding a home page | `toolexec:backend/actions/project/project-overview.ts`, `toolexec:frontend/src/components/mission-control/MissionControl.tsx` |
| CLI follow | The polling follower this phase replaces with a socket | `toolexec:cli/src/follow.ts` |
| v1 thread titles | `generateThreadTitle` on the fast model, fire-and-forget | [src/utils/title.ts](https://github.com/evantahler/botholomew/blob/v1/src/utils/title.ts) |
| v1 chat surfaces | Queue panel, folded tool-call cards, MCP tool display names | [QueuePanel.tsx](https://github.com/evantahler/botholomew/blob/v1/src/tui/components/QueuePanel.tsx), [ToolCall.tsx](https://github.com/evantahler/botholomew/blob/v1/src/tui/components/ToolCall.tsx) |
| The loop | Threads, conversations, inbox, `whenBusy`, guards, `tool-call:decide`, `conversation:stop`, `ThreadChannelOps` | [phase 6](./phase-0006-durable-bot-loop.md) |

## What this must not weaken

1. **The project is the privacy boundary.** No thread is private; a thread is readable by whoever can read
   its owner bot, and the user docs say plainly that anything said to a bot may surface to anyone who can
   read that bot.
2. **A channel subscribe is never a weaker oracle than the read it accelerates.** Every per-subject channel's
   `authorize()` repeats the exact check of the action a client would re-read through.
3. **Frames are content-free** — with one argued exception, the token stream, whose audience is exactly the
   thread's readers and which is never the delivery.
4. **The socket is an accelerant.** Every page and the CLI follower hydrate over HTTP on open and on
   reconnect; nothing depends on a socket having been open.
5. **Recipients are never routed around access.** A message reaches only bots its sender may write; a
   notification reaches only people who can read what it points at.
6. **The guards still hold.** Mentions and `@everyone` route through phase 6's hop, chain, and rate guards;
   no routing rule bypasses them.

## Design

### Who hears a message

Evaluated on the server, at `message:send` and when a bot's message is posted. Rules 1–3 combine; rule 4
applies only when none of them named anyone:

| # | Rule | Recipients |
|---|---|---|
| 1 | Reply to a bot's message (`replyToMessageId`) | that bot |
| 2 | `@bot` mentions | each mentioned bot |
| 3 | `@everyone` | every bot participant in the thread |
| 4 | Unaddressed | **the owner bot only** |

An author is never its own recipient. A person must `canWriteBot` every recipient; a mention of a bot they
cannot write is not routed and comes back in `unrouted: [{ bot, reason }]`, and a message whose every named
recipient is unroutable is **refused with nothing written** — posting a message nobody will hear, while the
composer looked like it worked, is the failure ToolExec's undeliverable-message learning names. A mentioned
bot joins the thread as a participant in the same transaction.

**Unaddressed goes to the owner, not to "whoever wants it".** Grok Bot's group chats let the participating
bots decide who responds to a plain message, and its own guidance then warns that "too many parallel
handoffs can create duplicate work and noisy updates" and asks for "a single owner at each stage". Routing
plain messages to the owner makes the cost one model call instead of N, and makes "who will answer this"
something the person typing can predict. `@everyone` is the deliberate opt-in to N calls, and its recipients
are told they were addressed collectively (an `event` line in the volatile tail), so an empty reply —
silence — is the expected answer from a bot with nothing to add.

**Bots route by the same rules, minus `@everyone`.** A bot's final text or `send_message` body may
`@mention` any bot in the project and is subject to phase 6's hop, chain, and rate guards. A bot's
`@everyone` is not routed: fan-out is a leader's job through delegation ([phase 13](./phase-0013-leader-and-workers.md)),
where it is a task with an owner rather than a broadcast.

**Mentions are structured.** The web composer's autocomplete inserts a token such as `@{bot:12}` or
`@{user:7}`, rendered as the name; plain `@slug` from the CLI or an MCP client is resolved against the project's bot slugs;
the server stores the result in `thread_messages.mentions` and never re-parses rendered text. A person
mentioning a person creates a `mentioned_you` notification for them (if they are a member who can read the
thread) and routes nothing. Bots cannot mention people in this phase.

### Owner, participants, and kinds

| Kind | Created by | Owner | Participants |
|---|---|---|---|
| `chat` | a person (web, CLI, MCP) | chosen at creation, default the project's leader | the creator, the owner, anyone who posts, anyone mentioned or added |
| `dm` | `send_message` to a bot | the sending bot | exactly the two bots |
| `delegation` | [phase 13](./phase-0013-leader-and-workers.md) | the delegating bot | leader and worker |
| `slack` / `imessage` | [phases 16](./phase-0016-slack.md) / [17](./phase-0017-imessage.md) | the bound bot | mapped remote people |

Ownership transfers with `thread:edit` (audited), which requires write on both the old and the new owner —
Grok Bot's "pass ownership of a task" as a deliberate act. The owner cannot be removed while it owns.
Removing a bot participant stops new deliveries to it; its conversation remains as history, and a later
mention re-adds it. A deleted owner bot leaves the thread ownerless: readable by every member, and an
unaddressed message there is refused with a sentence asking the sender to mention a bot or set an owner.

### Who can read a thread

`canReadThread(thread, caller)` is: an admin; or the caller can read the owner bot; or the thread is
ownerless and the caller is a member. Nothing else. A reader of a *participant* bot that is not the owner
does not get the thread — but they can read that bot's own conversation (`conversation:view`), which holds
exactly what was delivered to it. That is the privacy decision applied literally: what is said **to** a bot
surfaces to that bot's readers. `thread:list` applies the rule in SQL (owner-bot access lists joined against
the caller's tags), so pagination totals are true for the caller.

### Live updates

| Channel | Subscribe check | Frame | Wakes |
|---|---|---|---|
| `project:<p>:threads` | membership | `{ event: "threads" }` — names no thread | thread list, project home |
| `project:<p>:thread:<t>` | membership, then `authorize()`: `canReadThread` | `{ event: "thread", thread: { id, projectId, kinds } }`, `kinds` ⊆ `messages`, `transcript`, `status`, `participants`, `inbox`, `title` | thread page |
| `project:<p>:thread:<t>:stream` | membership, then `canReadThread` | `{ event: "delta", conversationId, modelStepId, seq, text }` | the live reply |
| `project:<p>:bot:<b>` | membership, then `canReadBot` | `{ event: "bot", bot: { id, projectId, kinds: ["status"] } }` | status chips, bot page |
| `project:<p>:notifications` | membership | `{ id, userId }` (ToolExec's shape) | bell, toasts |

The list channel can be membership-only *because* it names nothing; the per-thread channel names a thread, so
its `authorize()` repeats `thread:view`'s check and returns the same 404/403, so a subscribe is never a
second, weaker oracle (ToolExec phase 18). Channel names match Keryx's
`/^[a-zA-Z0-9:._-]{1,200}$/`.

**The stream is the one channel that carries content**, and the argument is narrow. Token deltas cannot be
re-read — they exist only until the step's entry commits — so a content-free ping cannot replace them. The
audience is exactly the thread's readers, checked at subscribe. And the stream is never the delivery: when a
step commits, a `transcript` ping makes the page re-read the real entry, and the live bubble is replaced.
The publisher coalesces deltas (every 100 ms or 512 characters), numbers them per step, and checks channel
presence once per step so it does not publish to nobody. The client renders only a contiguous run of `seq`
for the current `modelStepId`; on a gap, a reconnect, or a new step, it drops the partial and waits for the
re-read. Interim text streams too, styled as work in progress, because watching the bot think is the point
of a live view; it simply never becomes a message.

**MCP sessions.** Keryx forwards PubSub to MCP clients as logging messages, "only to sessions whose
authenticated user is authorized to subscribe to that channel". So `authorize()` guards MCP clients as well
as sockets, and the tests assert it for the stream channel specifically: an MCP session of a member who
cannot read the owner bot receives no frame. Whether an *authorized* MCP session receives a channel's frames
without subscribing is pinned by a test either way; if it receives every token delta of every thread it can
read, that noise is filed upstream with a repro (rule 4), not worked around here.

**One socket, subscribe then hydrate.** `LiveSocketContext` is ported as is: one reconnecting socket,
handlers in refs, `createChannelRegistry`'s microtask-delayed unsubscribe so a React remount never sends
subscribe → unsubscribe → subscribe into Keryx's unordered frame handling, effects that subscribe before they
load, and a full re-read on every (re)connect. Call sites for the phase 6 publisher are every commit a reader
would notice: a message posted or routed, an inbox claim or drop, a step or tool outcome, a status change, a
participant or title change.

### Notifications

Ported from ToolExec with three changes. **Browser channel only** for now (see Out). **Templates:**
`mentioned_you`, `conversation_errored`, `conversation_blocked` (budget, unpriced model, no model),
`routing_stopped` (hop or chain limit), `tool_call_waiting` (a gated call needs a decision; phase 10 replaces
it with its approval template), and `bot_replied` — sent only to the turn's human, only when the turn took
longer than 30 seconds (they have probably looked away), and marked read automatically when they open the
thread. **Recipients:** the turn's human when there is one; otherwise the holders of the bot's `accessWrite`
tags; otherwise the project's admins — and always filtered to people who can read the thread, because
ToolExec learned that a notify-tag that routes around `accessRead` is a leak.

Rows are written by `enqueueNotification(tx, …)` in the same transaction as their cause (the phase 6 tick's
release for errors and blocks, routing for mentions and stops), and `afterCommit` enqueues
`notifications:dispatch` as an accelerant; the clock is the delivery. A browser row is marked `sent` when
broadcast and never retried. `payload` holds ids, the bot's name, and the thread title — nothing from a
transcript — and the frame holds only `id` and `userId`.

### The thread page

`docs/TRANSCRIPT_UI.md`'s verdict — a run transcript is a log, not a thread of bubbles, so no chat kit — is
right for ToolExec and half-right here. **A thread is a conversation between people and bots**, so the page
is a message list: people's messages and bots' replies as messages, notices as centred lines. **A bot's turn
is still a log**, so each reply carries a folded disclosure above it — *worked 42 s · 6 tool calls · 1
waiting* — that opens onto that turn's entries in the log grid: each tool call beside its result, previews
truncated in memory, interim text dimmed, fenced content labelled with its source, and a gated call as an
inline card with Approve / Deny (`tool-call:decide`). The gates from that document all still apply:
`MarkdownBlock` is the only markdown renderer, there is no chat-kit dependency, no `role="log"` (a polite
live region announces only a bot's final reply), and following the newest message is decided by scroll
position (`useStickToBottom`), never a mode.

- **Header:** the title (editable), the owner chip (transfer), participants (add / remove), and one status
  chip per bot conversation in the thread — `working · 40 s`, `waiting for you`, `errored · Retry`,
  `paused`, or nothing when hibernating.
- **Live bubble:** while a conversation is running, the current step's streamed text under the last message.
- **Delivery labels:** a person's message shows `queued` while its inbox row is unclaimed, `steered` when it
  was, and `not delivered — stopped by Evan` when it was dropped.
- **Composer:** `@` autocomplete over bots the person may write and people in the project; **Send** (a
  follow-up); **Steer**, offered only while a conversation this message would reach is running; **Stop**
  beside each running bot's chip; a reply-to affordance on a bot's message; and the pending queue ("2
  queued for Botholomew"). Which controls exist and the sentence under the field are one pure function,
  `threadComposerState`, in the style of ToolExec's `runFollowUp.ts`, so every branch is a unit test.

**Titles.** After a thread's first bot reply, `thread:title` (task-only) asks the project's fast model for a
title — v1's `generateThreadTitle` — unless a person already set one. Failure leaves "Untitled" and logs;
the usage is recorded with `kind: "title"`.

### The project home and the thread list

`project:overview` composes the home in one read: every bot with its live status and what it is doing
(*working in "Q3 plan" for 40 s*), threads with a running conversation, **Waiting for you** (gated calls,
errored and blocked conversations the caller can act on), and recent threads. It subscribes to
`project:<id>:threads` and each visible bot's channel. The thread list (`/threads`) has *Mine* (participant)
and *All* (readable) tabs, a bot filter, unread counts from `thread_participants.lastReadMessageId`, and the
same list channel.

### `botholomew thread follow` uses the socket

ToolExec's CLI follower polls, and its phase 18 left that alone on purpose. Following a thread is different:
the token stream exists only on the socket. So the CLI gains a small Keryx WebSocket client
(`cli/src/socket.ts`) that authenticates with the session cookie, subscribes to the thread and stream
channels, then hydrates over HTTP — the browser's discipline exactly — prints messages, one summary line per
turn (`· worked 42 s, 6 tool calls`), and live deltas, and re-reads on reconnect. Ctrl-C exits; it does not
stop the bot (`botholomew conversation stop` does).

## Steps

### 1. Schema — `backend/schema/{threads,thread_participants,thread_messages,notifications,usage_events}.ts`

| Table | Change | Notes |
|---|---|---|
| `threads` | `titleSource` (`person` \| `generated` \| `null`) | a generated title never overwrites a person's |
| `thread_participants` | `role` (`owner` \| `member`), `lastReadMessageId`, `addedByUserId`, `addedByBotId` | one `owner` row per thread, kept in step with `threads.ownerBotId` by `ThreadOps` |
| `thread_messages` | `replyToMessageId` (null, set null), `mentions jsonb` (`{ bots: [], users: [], everyone }`) | routing reads `mentions`, never the body |
| `notifications` | new, ported: `projectId`, `userId`, `channel`, `template`, `payload jsonb`, `status`, `attempts`, `nextAttemptAt`, `sentAt`, `error`, `readAt`, `linkPath`, plus `threadId` (null, cascade) | ToolExec's `(status, nextAttemptAt)` and `(userId, channel, readAt)` indexes, plus `(userId, threadId)` where `readAt` is null for read-on-view |
| `usage_events` | `kind` gains `title` | — |

### 2. Ops — `backend/ops/{ThreadOps,NotificationOps,ThreadChannelOps,ProjectOverviewOps}.ts`

- `ThreadOps` — `resolveRecipients(tx, message, author)` → `{ routedTo, unrouted }` (the rules above, then
  phase 6's `routingVerdict`); `parseMentions(body, structured)`; `addParticipant` / `removeParticipant`;
  `transferOwner`; `canReadThread`; `listReadableThreads(caller, filters)` (SQL access filter, paginated).
- `NotificationOps` — ported `enqueueNotification`, `claimDueNotifications`, `deliverNotification`
  (browser only), `setBroadcasterForTesting`; new `recipientsFor(tx, conversation, template)` and the six
  templates as plain functions.
- `ThreadChannelOps` — channel-name builders and patterns; `broadcastThreadsUpdate`; `publishDelta` with
  coalescing and the per-step presence check.
- `ProjectOverviewOps` — `composeOverview(projectId, caller)`.

### 3. Channels — `backend/channels/{projectThreads,projectThread,projectThreadStream,projectBot,projectNotifications}.ts`

Each is a `Channel` with the membership `ChannelMiddleware` from ToolExec's `projectRun.ts`; the three
per-subject channels add `authorize()` calling `canReadThread` / `canReadBot` and throwing the same 404 / 403
their HTTP twins throw.

### 4. Actions — `backend/actions/{thread,message,project,notification}/*.ts`

| Action | Route | Middleware / RBAC | Audited | MCP |
|---|---|---|---|---|
| `thread:list` | `GET /threads` | member; filtered by `canReadThread`; `mine`, `botId`, `unread` filters; paginated | no | yes |
| `thread:edit` | `POST /thread` | member + `canWriteBot(owner)`; title; owner transfer also needs `canWriteBot(newOwner)` | yes | yes |
| `thread:participant-add` | `PUT /thread/participant` | member + `canWriteBot(owner)`; a bot also needs `canWriteBot(bot)`; a person must be a member | yes | yes |
| `thread:participant-remove` | `DELETE /thread/participant` | as above; refuses the owner | yes | yes |
| `thread:mark-read` | `POST /thread/read` | session + `canReadThread`; writes only the caller's participant row and their notifications for that thread | no — read state, the notification family's exception; [AGENTS.md](../../AGENTS.md)'s closed list gains it | **never** — an assistant must not silence a person's unread state |
| `message:send` (changed) | `PUT /message` | adds `replyToMessageId`, structured `mentions`; returns `routedTo` and `unrouted`; refuses with nothing written when nothing is routable | yes | yes |
| `project:overview` | `GET /project/overview` | member | no | yes |
| `notification:list` / `:unread-count` | `GET /notifications`, `GET /notifications/unread-count` | session; the caller's own browser rows | no | yes |
| `notification:mark-read` | `POST /notifications/read` | session; the caller's own rows | no | **never** |

### 5. Clocks and tasks — `backend/actions/{notification,thread}/*.ts`

| Task | Frequency | Queue | Does |
|---|---|---|---|
| `notifications:dispatch` | 10 s | `orchestrator` | claim due rows `FOR UPDATE SKIP LOCKED`, broadcast, mark `sent` |
| `notifications:sweep` | daily | `default` | delete rows past `NOTIFICATION_RETENTION_DAYS` (30) |
| `thread:title` | one-off | `default` | title from the fast model; skips if `titleSource = person` |

### 6. Frontend — `frontend/src/{context,pages,components/threads,utils}/…`

- `context/LiveSocketContext.tsx`, `context/NotificationContext.tsx` — ported; the bell returns to
  `Layout`.
- `pages/ProjectHomePage.tsx` — the overview: bots grid, live threads, Waiting for you, recent threads.
- `pages/ThreadsPage.tsx`, `pages/ThreadPage.tsx`, and `pages/NewThreadPage.tsx` (owner picker, first
  message).
- `components/threads/{MessageList,TurnDisclosure,TurnLog,LiveBubble,GatedCallCard,BotStatusChip,Composer,MentionAutocomplete,ParticipantsPanel}.tsx`.
- `utils/{threadComposer,turnLog,streamAssembler,mentions}.ts` — pure, unit-tested.

### 7. CLI — `cli/src/{socket.ts,commands/thread.ts,commands/notification.ts}`

| Command | Action |
|---|---|
| `botholomew thread list [--mine] [--bot <slug>] [--unread] [-l] [-o]` | `thread:list` |
| `botholomew thread follow <id>` | channels + `thread:view` / `conversation:view` |
| `botholomew thread send <id> <message> [--to @slug…] [--everyone] [--reply-to <messageId>] [--steer]` | `message:send` |
| `botholomew thread rename <id> <title>` / `thread owner <id> <slug>` | `thread:edit` |
| `botholomew thread participants <id> [add\|remove <@slug\|email>]` | `thread:participant-*` |
| `botholomew notification list [--unread]` / `notification read <id…> \| --all` | `notification:*` |

Every command takes `--json`. Bumps `cli/package.json`.

### 8. User docs — `frontend/src/content/docs/{threads,bots,notifications,cli,mcp,security}.md`

`threads.md` grows routing (owner, mentions, `@everyone`, reply-to), participants, ownership, who can read a
thread, queue vs. steer vs. stop, and what the folded work shows. `notifications.md` (new, registered in
`sections.ts`) lists each template and who receives it. `security.md` states the privacy rule in one
sentence a person cannot misread. `cli.md` documents `thread follow`; `mcp.md` shows Claude Desktop listing
threads and messaging a bot.

### 9. Tests — `backend/__tests__/{channels,actions}/*.test.ts`, `frontend/…`, `cli/__tests__/…`

`channels/project-thread.test.ts`
- A reader of the owner bot subscribes and receives a frame whose key set is exactly `id`, `kinds`,
  `projectId`.
- **A member who cannot read the owner bot is refused and receives nothing after trying** — both halves,
  broadcast after the refusal and wait.
- A non-member and an unauthenticated socket are refused; a malformed name is refused, not thrown.
- The `threads` list channel's frame contains no thread id.

`channels/project-thread-stream.test.ts`
- Deltas from a real `bot:tick` run on the task path reach a socket on the web server in `seq` order — the
  worker → Redis → socket path, not an in-process shortcut.
- A restricted member's subscribe is refused and they receive no delta.
- An MCP session (`getMcpAccessToken`) of a restricted member receives no logging message for the thread or
  its stream; an authorized MCP session's behaviour without subscribing is asserted as observed.
- No delta is published while the channel has no presence.

`channels/project-bot.test.ts`, `channels/project-notifications.test.ts` — the same refusal pair; the
notification frame's key set is exactly `id`, `userId`.

`actions/routing.test.ts`
- Unaddressed → the fake model server sees exactly one conversation's request, the owner's.
- `@slug` → that bot only, now a participant; `@everyone` → every bot participant; reply-to → that bot.
- A mention of a bot the sender cannot write is listed in `unrouted`; with nothing routable the send is
  refused and the counts of messages, inbox rows, and audit rows are all unchanged.
- A bot's `@everyone` routes nobody; bots mentioning each other trip phase 6's hop limit.

`actions/thread-visibility.test.ts`
- `thread:list` totals and rows exclude threads whose owner the caller cannot read; `thread:view` matches.
- An ownerless thread is readable by every member and refuses an unaddressed message.
- A reader of a participant bot sees, through `conversation:view`, only what was delivered to it.

`actions/participants.test.ts` — transfer needs write on both owners; the owner cannot be removed; removal
stops deliveries; a mention re-adds.

`actions/notification.test.ts`
- Recipients for each template; a recipient who cannot read the thread gets no row.
- `bot_replied` only after 30 s and only to the turn's human; opening the thread marks it read.
- `notification:mark-read` and `thread:mark-read` are not MCP tools and touch only the caller's rows.
- `payload` contains no transcript text.

`frontend/src/__tests__/{thread-composer,turn-log,stream-assembler,mentions}.test.ts` — every composer
branch and its sentence; every entry kind drawn or named as omitted (a closed list, as `transcriptChat`
does); a gap or a new step drops the partial.

`frontend/e2e/threads.spec.ts` — two browser contexts. A sends a message and sees the reply stream in, the
folded work open onto paired calls and results, and the bot chip go `working` → hibernating, **with no
reload**; A steers mid-turn and stops a turn; B, who cannot read the owner bot, gets a 403 page and no
socket frames; an errored conversation rings A's bell; closing the socket and reopening it re-reads.

`cli/__tests__/thread-follow.test.ts` — against a real server: `thread follow` prints streamed text, then the
committed reply once, and re-reads after the server drops the socket.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, with two browser windows — an admin, and a member whose tags can read only the "Research" bot:

1. As the admin, open the project home: Botholomew and Research show `hibernating`. Start a thread with
   Botholomew and ask for something that needs tools. The reply streams in; *worked · N tool calls* opens
   onto each call beside its result; the home's chip shows `working` and then clears, without a reload.
2. While it works, send a second message (it shows `queued`, then is answered in the next turn), then send
   one with **Steer** (it appears between steps).
3. Write `@Research what do you think?`. Only Research answers; it is now a participant.
4. As the member, open the thread list: the Botholomew thread is absent; opening its URL directly is a 403.
   Open Research's conversation from the bot page: only the `@Research` message and its reply are there.
5. In a terminal, `botholomew thread follow <id>`, and send from the browser: the CLI streams the reply.

Then the edge cases:

- Mention a bot the member cannot write, alone: the send is refused with a sentence and nothing appears.
- Two bots `@mention` each other in a loop: routing stops at the hop limit, a notice appears, and the bell
  rings `routing_stopped`.
- Kill the web service mid-stream: the page reconnects, drops the partial bubble, and shows the committed
  reply.
- Approve a gated test call inline: the turn continues without another model call.
- Close the tab during a long turn: `bot_replied` is waiting on return, and opening the thread clears it.
- **Deployed check:** the stream channel survives Render's proxy, and a Claude Desktop session sees
  `thread:list`, `thread:view`, and `message:send`.

## Definition of done

- [ ] Routing rules 1–4, structured mentions, auto-join, and refusal when nothing is routable; bot `@everyone` unrouted
- [ ] Participants, owner transfer, ownerless threads; `canReadThread` in SQL for `thread:list`
- [ ] Five channels with membership middleware and `authorize()` matching their HTTP twins; both halves of each refusal tested
- [ ] The stream channel: coalesced, sequenced, presence-gated, superseded by a re-read; MCP forwarding asserted for restricted members
- [ ] `LiveSocketContext` ported; every page and the CLI follower subscribe, then hydrate
- [ ] `notifications` ported, browser-only; six templates; recipients filtered by thread read; dispatch and sweep clocks
- [ ] Thread list, thread page (folded turn log, live bubble, inline gated calls, status chips, composer), new-thread page, project home
- [ ] `thread:title` on the fast model, never overwriting a person's title
- [ ] Actions as tabled, with audit and MCP policy; `AGENTS.md` lists updated
- [ ] CLI `thread list / follow / send / rename / owner / participants`, `notification list / read`, with `--json`
- [ ] User docs: threads, notifications, security, CLI, MCP
- [ ] Every test file above, including the two-context e2e spec

## Commands

```bash
botholomew thread list --unread
botholomew thread send 12 "@research can you check the numbers?" --reply-to 4810
botholomew thread follow 12
botholomew thread owner 12 research
botholomew notification list --unread

# The clocks by hand (ops CLI).
bun keryx.ts notifications:dispatch
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
