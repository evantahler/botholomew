# Phase 16 — Slack

> **Goal:** People in a Slack workspace talk to a project's bots where they already work. A DM to the
> project's app gets an answer to every message; an @mention in an enabled channel starts a thread the bot
> follows without being mentioned again; approvals arrive as cards in that thread; skills run as a slash
> command. Every message carries the same person's authority, attribution, and audit trail it would carry on
> the web.

> **Status: planned, not built.** Stage E — Everywhere. Depends on [phase 6](./phase-0006-durable-bot-loop.md)
> and [phase 7](./phase-0007-threads-and-web-chat.md) for the core; approval cards depend on
> [phase 10](./phase-0010-mcp-servers-and-approvals.md) and the slash command on [phase 12](./phase-0012-skills.md).

Grok Bot's pitch is "always-on AI teammates", and a teammate who can only be reached on one website is not
always on. Slack is where most of the people who will use Botholomew already spend the day, so this is the
first phase that takes the bots to the people instead of the other way round. The design is not new:
ToolExec settled it in `toolexec:docs/plans/phase-32-remote-interfaces.md` and never built it. This phase
implements that design, translated from ToolExec's runs and sandboxes into Botholomew's threads and
conversations, and using ToolExec's "Proposal B" shape (a thread is a conversation) rather than its
paging-first "Proposal A".

The translation is mostly subtraction. Botholomew has no sandbox, no run token and no `sandbox:reply`. A
bot's turn already ends in exactly one place, the final tool-free text that phase 6's one-output-channel rule
posts to the thread. So "a reply goes where its turn came from" becomes a rule about which thread messages
the outbox forwards to Slack, and ToolExec's sandbox invariants become invariants of the bot loop.

The phase deliberately leaves out ambient listening. A top-level channel message that does not mention the
app is never stored. Making that possible is a later, opt-in channel-listening schedule or event trigger
built on [phase 14](./phase-0014-schedules-and-wakeups.md). Grok Bot's own guidance warns against triggers
that react to every new message, and so does the budget.

## Scope

**In:** linking a Slack identity to a Botholomew user (code minted in a signed-in session, presented from
Slack); a per-project Slack app created from a generated manifest, held as an encrypted `slack` connection;
signed ingress `webhook:slack-events` and `webhook:slack-interactivity`; the three kinds of sender; DMs,
mentions and followed threads; audited channel enablement; the `remote_threads` mapping between a Slack
thread and a Botholomew `slack` thread; the `outbox` with `remote:deliver` and `remote:dispatch`; Block Kit
approval cards; a `/botholomew` slash command over shared skills; a content-free working indicator; and the
RBAC, audit, MCP policy, CLI, UI and user docs for each.

**Out:** iMessage ([phase 17](./phase-0017-imessage.md), which reuses the identity, thread, and outbox
foundations built here). Ambient channel listening, which waits for a later schedule or event trigger
beyond [phase 14](./phase-0014-schedules-and-wakeups.md). Paging, meaning Slack DMs for approvals and failures
that began on the web (unphased; it is one more fan-out row once identities exist). A shared, Marketplace-listed
Slack app (unphased; see "The per-project app"). Streaming tokens into Slack, and Slack Connect and
other externally shared channels. Attachments in either direction. Reading channel history from before the
mention. Retention of Slack-originated text, which is the ordinary thread retention of
[phase 18](./phase-0018-operations.md) with no second rule.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| ToolExec's remote-interfaces plan | The settled design: identities as links, three senders, signed ingress, the outbox, the per-project manifest app, loops, and the double-post limit | `toolexec:docs/plans/phase-32-remote-interfaces.md` |
| The event-ingress discipline | Raw body, a byte-identical 404, a per-token rate limit, a body cap, and dedupe before any transcript line | `toolexec:backend/actions/webhook/session-event.ts`, `toolexec:backend/ops/RawRequestOps.ts`, `toolexec:backend/ops/WebhookOps.ts` |
| Encrypted per-project connections | `project_connections` plus AES-256-GCM, ported in [phase 5](./phase-0005-bots.md), with one definition per kind | `toolexec:backend/schema/project_connections.ts`, `toolexec:backend/connections/registry.ts`, `toolexec:backend/ops/CryptoOps.ts` |
| Notification dispatch | A table instead of a direct send, a `SKIP LOCKED` claim, and backoff ending in a terminal state | `toolexec:backend/ops/NotificationOps.ts`, `toolexec:backend/actions/notification/notifications-dispatch.ts` |
| The MCP policy | `webhook:*` is never published to MCP, by prefix; the never-MCP list is closed | `toolexec:backend/ops/McpToolPolicyOps.ts` |
| A fake upstream | The `Bun.serve` stub behind a configurable base URL that the model-proxy tests use | `toolexec:backend/__tests__/actions/proxy-model.test.ts` |
| The loop | `thread_messages` with `requestId` (unique per project) and `causedByMessageId`; `conversation_inbox`; human priority; one output channel; provenance fencing; the `outbox` named in core architecture §8 | [phase 6](./phase-0006-durable-bot-loop.md) |
| Threads | `message:send`, owner routing and `@bot` mentions, `canWriteBot`, and the notifications table | [phase 7](./phase-0007-threads-and-web-chat.md) |
| Approvals | An `approvals` row per gated `tool_call`; allow once, always allow, or deny; the recorded call runs exactly as recorded | [phase 10](./phase-0010-mcp-servers-and-approvals.md); v1 [src/approvals/decide.ts](https://github.com/evantahler/botholomew/blob/v1/src/approvals/decide.ts) |
| Skills | v1's parser and renderer (`$ARGUMENTS`, `$1`–`$9`, named args, a greedy last argument) | [phase 12](./phase-0012-skills.md); v1 [src/skills/parser.ts](https://github.com/evantahler/botholomew/blob/v1/src/skills/parser.ts) |

What does not exist: any notion of who a person is outside Botholomew, any way to send something that is not
a WebSocket frame or an email, and any mapping from an outside conversation to a thread.

## What this must not weaken

1. **The project is the privacy boundary, and content leaves it only to an audience somebody chose.** A
   bot's words reach Slack only as the reply to a Slack message, in that message's Slack thread, in a DM
   with a linked member or in a channel a bot writer enabled. Nothing typed on the web, by the CLI, by a
   schedule, or by another bot is mirrored into Slack.
2. **A Slack message carries a linked person's authority or none.** Authority is resolved per message from
   that user's current membership and the bot's `accessWrite` tags. It never comes from the channel, the
   workspace, the app, or whoever enabled the channel.
3. **Every human decision is audited, whatever carried it.** A message from Slack, an approval clicked in
   Slack, and a channel enabled from Slack write the same action names as the web, and the transport is
   recorded as metadata.
4. **Postgres first, then the network, in both directions.** An inbound message is a committed row before
   Slack gets its 200. An outbound message is an `outbox` row before anything calls Slack.
5. **One output channel.** Only the final, tool-free text of a turn is posted. Interim text stays
   transcript-only, and an empty final text is silence in Slack too. This phase adds no mid-turn reply tool.
6. **Credentials never reach a model or code mode.** The bot token and signing secret are decrypted only
   inside `SlackOps` in the worker or API process. They are never part of a prompt, a tool result, a
   code-mode host function, an audit row, or a log line.
7. **Machine ingress is never an MCP tool, and neither is anything that arms it.** That covers
   `webhook:slack-*`, minting a link code, connecting the app, and enabling a channel.
8. **BYOK spend stays under the project's control.** Every accepted Slack message is a model turn on the
   project's own key, so it passes the same budgets, rate limits and pending-inbox cap as a web message.
9. **Untrusted content stays fenced.** Text other people wrote (shared messages, unfurls, quoted
   attachments) reaches the model as fenced data with provenance, never as the sender's instruction.

## Design

### A remote identity is a link to a person

`user_remote_identities` links an outside identity (`transport`, `externalId`) to one Botholomew user.
Unique on `(transport, externalId)`: a Slack user is at most one person, or authority would depend on which
row a query found first. For Slack, `externalId` is `teamId:userId`. The identity belongs to the person and
not to a project, so one link serves every project whose app lives in that workspace.

**The code is minted in a signed-in session and presented from Slack.** The person presses *Link Slack* on
Account → Linked accounts (or runs `botholomew identity link slack`) and gets `ABCD-EFGH`. That is 40 bits
from Crockford base32, parked in Redis under `link:<code>` → `userId` with a ten-minute TTL and consumed
with `GETDEL`. They DM it to any project's Slack app. The signed event names the Slack identity, the code
names the person, and the bind is one audited write (`identity:link`, recorded through `writeAuditLog` with
the minting user as actor and `via: "slack"`). The reverse direction, a "click to link" URL the bot sends, is
the phishing-shaped one ToolExec rejected: an attacker requests a link for their own Slack identity and a
signed-in victim clicks it. Minting in the session means a victim would have to read the code out instead.
Codes are accepted only in the app's DM, never in a channel. Presentation attempts are limited to five
failures per Slack identity per fifteen minutes. **`identity:link-start` is never an MCP tool:** a model that
could mint a code and repeat it to someone else could bind that person's Slack account to yours.

Unlinking is the person's own audited action. Removing someone from a project needs no Slack-specific step,
because their next message resolves to a user without membership and is refused.

### Three kinds of sender

| Sender | Resolves to | May do | Written as | Audited |
|---|---|---|---|---|
| A linked person | a `userId` | Exactly what the web allows that user right now: message a bot only with `canWriteBot`, and answer an approval only with `canWriteBot` on the requesting bot | A `thread_messages` row authored by the user with `metadata.via: "slack"`, then inbox rows | Yes, under the same action name as the web path |
| An unlinked person | nobody | Nothing. That includes threads a linked writer started | Nothing in Postgres; an ephemeral "link your account" note | No |
| A bot, another app, or our own echo | — | Nothing | Dropped before any write | No |

A refusal is ephemeral (`chat.postEphemeral`) and says what to do next: link your account, or ask a project
admin for write access to the named bot. The link note is sent at most once per Slack user per channel per
hour, so an unlinked guest in a busy thread does not get one note per message. The bot's view of a Slack
thread is therefore the linked writers' messages only, which is also what the thread page shows. Letting
anyone in a channel post unattributed turns was considered and rejected, as ToolExec did: it would let any
guest steer a bot and spend the project's key.

### Where the bot listens: DMs, mentions, and followed threads

This follows the Grok Bot shape:

- **The app's DM answers every message.** Each top-level DM message opens its own Botholomew thread, and
  the bot replies in the Slack thread under it. Separate asks keep separate context, as ToolExec decided for
  sessions. Replies in that Slack thread continue the conversation.
- **A channel @mention starts a thread.** `app_mention` at the top level of an enabled channel creates a
  Botholomew thread keyed on the mention's `ts`. A mention inside an existing human thread keys on that
  thread's `thread_ts`. History from before the mention is never read: it was written by people who had not
  addressed the bot.
- **The bot follows its threads without re-mention.** A `message.channels` / `message.groups` event whose
  `thread_ts` matches a `remote_threads` row is delivered to that thread, and an `@` is not required.
- **Everything else is ignored.** A top-level channel message without a mention, or a reply in a thread the
  bot does not follow, has no matching row. Ingress answers 200 and writes nothing.

New Slack threads are owned by the connection's **default bot**, which is the project's leader unless an
admin picks another. A plain-text `@slug` in the message still routes to that bot by
[phase 7](./phase-0007-threads-and-web-chat.md)'s rules. Replies are posted with `chat:write.customize`, so a
worker bot's answer shows that bot's name and avatar instead of the app's. A Slack message is human input:
human priority, `whenBusy: follow_up` (steering from Slack is unphased), and `causedByMessageId` null. Edits
and deletions (`message_changed`, `message_deleted`) are dropped, and an edited message is not re-run.

### Enabling a channel is an audience decision

A DM's audience is one linked member, who is already inside the boundary. A channel's audience is everyone
in it, today and later, and they need not be project members. So a channel must be **enabled** before a
mention there does anything, and enabling is an audited decision (`slack-channel:enable`). It can be made on
the web or from Slack: a linked writer who mentions the app in a channel that is not enabled gets an
ephemeral card with an *Enable here* button. Either way the confirmation says it plainly:
*everyone in #deploys will read what the bots reply here, and everyone in the project can read these threads.* The
second half is the project boundary seen from the other side. Slack participants should know their messages
are readable by project members.

Only someone with `canWriteBot` on the default bot may enable a channel. `conversations.info` must say the
channel is not `is_ext_shared`, `is_shared`, or `is_org_shared`. Slack Connect is refused at enable time and
re-checked at every inbound event, because a channel can become shared later. Disabling (writer or admin,
audited) stops ingress at once. In-flight outbox rows for that channel end `undeliverable` with
`channel_disabled`.

Nothing here promises redaction. As ToolExec learned with human help, a redactor over model output fails
quietly. The audience decision is the control.

### A Slack thread is a Botholomew thread

`remote_threads` maps `(connectionId, externalKey)` to exactly one `threads` row of kind `slack`, where
`externalKey` is `teamId/channelId/threadTs`. The unique key includes `connectionId` and not just the
transport. Two projects' apps can sit in the same channel, and one Slack thread can then be two Botholomew
threads, one per project. Each app sees only its own mentions, and each project's loop filter drops the
other app's posts.

On the web, a `slack` thread is readable by every project member, like any thread. **Its composer is
read-only** and offers *Reply in Slack*. A web message in a Slack thread would get a reply that one
invariant forbids mirroring, so the Slack side would silently skip turns. Making that impossible is simpler
than explaining it. Approvals for those threads can still be decided on the web.

### One output channel, delivered through the outbox

Phase 6 posts a turn's final, tool-free text to the conversation's thread as a bot `thread_messages` row.
In a `slack` thread, that insert also writes an `outbox` row **in the same transaction** when the row's
**causal root** came from this Slack thread. The causal root is found by following `causedByMessageId` to
the first human message. The root rule handles the cases that matter:

| Turn started by | Root | Delivered to Slack? |
|---|---|---|
| A Slack message in this thread | that message | yes |
| A worker's report (`event`) on a delegation started from this Slack thread | the Slack message that led to the delegation | yes, so the leader's answer arrives hours later in the thread it was asked in |
| A schedule, a webhook, or a wakeup in this thread | none | no |
| `send_message` from another thread | — | refused (below) |

`send_message` aimed at a `slack` or `imessage` thread is refused with a hinted error (*this thread is
mirrored to Slack; a bot speaks there only as the reply to a message from Slack. Reply in your own thread,
or ask the person to mention you there*). Otherwise any thread's content could be posted into any channel.
Interim text never reaches Slack, and nothing replaces ToolExec's `sandbox:reply`. A person waiting in Slack
sees a **content-free working indicator** instead: an `eyes` reaction is added to the triggering message
when its turn leases and removed at release. That is two best-effort `status` outbox rows, one attempt each,
and never retried, because a lost reaction is not worth a second call.

Delivery uses `chat.postMessage` with `thread_ts`, `markdown_text`, the bot's `username` and `icon_url`, and
`unfurl_links: false` / `unfurl_media: false`, so no URL a bot writes is fetched by Slack and previewed to
the channel. Outbound text is neutralized: `<!channel>`, `<!here>`, `<!everyone>`, and `<@U…>` user mentions
are escaped, so a bot cannot ping a channel because a prompt-injected page asked it to. Text over Slack's
12,000-character `markdown_text` limit is cut at a paragraph boundary and ends with *continued in
Botholomew →* and the thread link. The first reply in every thread carries that link as a context block.

Each post tags itself with Slack message metadata (`event_type: "botholomew_outbox"`, `event_payload:
{ outboxId }`). That is how the **double-post limit** is narrowed. `chat.postMessage` takes no idempotency
key, so a worker that dies after Slack accepts a post but before `sent` commits leaves the row `sending`.
Before re-posting such an uncertain row, `remote:deliver` reads the thread (`conversations.replies`, with the
history scopes the message events already require; a per-project internal app is not under the
commercial-app history rate limit) and looks for its own `outboxId`. Only if it is absent does it post again.
A post Slack accepted but has not yet made visible can still appear twice. That is the remaining limit, and
the user docs state it.

### Ingress discipline

`webhook:slack-events` and `webhook:slack-interactivity` take `rawBody: true` and run in this order. Nothing
is written before step 3.

1. Look up the connection by the path's routing token. An unknown token, or a `pending`, `errored` or
   deleted connection, returns **one byte-identical 404**.
2. Cap the body at 1 MB, then verify `X-Slack-Signature` = `v0=` + HMAC-SHA256(signingSecret,
   `v0:{X-Slack-Request-Timestamp}:{raw body}`), compared in constant time, with the timestamp within five
   minutes. A failure returns 401 and writes nothing. `url_verification` is answered only after this step.
3. Drop events that are not ours: `api_app_id` ≠ the connection's app, any `bot_id`, the subtypes
   `bot_message`, `message_changed` and `message_deleted`, our own `botUserId`, and Slack Connect channels.
   Handle `app_uninstalled` and `tokens_revoked` by marking the connection `errored` and notifying admins.
4. Resolve the sender (the three kinds above), then rate-limit per identity (20 messages a minute) and per
   remote thread (30 a minute), on top of phase 6's per-project limits and the pending-inbox cap. Over the
   limit, the sender gets an ephemeral *slow down* and nothing is written.
5. **Dedupe on the message, not the envelope.** The core architecture names Slack's `event_id` as the
   `requestId`, and this phase refines that, because ToolExec found one Slack message can arrive as two
   events: a mention inside a followed thread is delivered as both `app_mention` and `message.channels`, with
   different `event_id`s. `requestId` is therefore `slack:<teamId>:<channelId>:<ts>`. That value is identical
   across both events and every retry, and phase 6's `(projectId, requestId)` unique index collapses them to
   one row. `event_id` is kept in `metadata` and used only as a Redis `SET NX` short-circuit (one hour) for
   the cheap no-write paths. Interactivity needs no `requestId`. An approval decision is a conditional update
   on `status = 'pending'`, so a retried click finds it already decided.
6. In one transaction: the thread (if new), the `remote_threads` row, the attributed `thread_messages` row,
   its inbox rows, and the audit row. These go through **the same op `message:send` uses**, so lock order,
   routing, hop counting and rate limits cannot drift between the composer and Slack. `afterCommit` enqueues
   `bot:tick`. The 200 goes out after commit, well inside Slack's three seconds.

### Approval cards

When a tool call enters `awaiting_approval` ([phase 10](./phase-0010-mcp-servers-and-approvals.md)) in a turn
whose causal root is a Slack message, the same transaction writes an `approval_card` outbox row into that
Slack thread. The card is a Block Kit message with the bot, the MCP server and tool, a 300-character preview
of the recorded arguments, a link to the full approval on the web, and three buttons: *Allow once*, *Always
allow*, *Deny*. The audience already chose to see this thread, so the preview reveals nothing it could not
read in the reply.

A click arrives at `webhook:slack-interactivity` as `block_actions` with `value: approval:<id>:<choice>`. The
clicker is resolved like any sender and then runs **exactly the check `approval:decide` makes on the web**:
`canWriteBot` on the requesting bot, plus the policy permission for *Always allow*. The requester normally
passes because they needed write access to send the message, but they are re-checked anyway, since access can
be revoked mid-turn. The decision is audited as `approval:decide` with `via: "slack"`. The card is rewritten
by an `update` outbox row (`chat.update`), for example *Allowed once by Evan*, and phase 10 re-queues the
conversation. An unauthorized clicker gets an ephemeral refusal naming who can decide, and nothing is
written. A losing race gets an ephemeral *already denied by Ana on the web*.

### Skills as a slash command

The manifest declares one command, `/botholomew`. A command per skill would mean regenerating the app each
time someone edits `skills/`, and Slack command names are workspace-global. `/botholomew help` lists the
project's skills, ephemerally. `/botholomew <skill> <args>` renders the skill through phase 12's parser.
Missing or ambiguous arguments return the parser's usage text in the HTTP response, which Slack shows
ephemerally, and nothing is written. On success the rendered text becomes the linked person's message in a
new `slack` thread. A slash command creates no visible Slack message, so the app posts an anchor in the
channel or DM (*Evan ran `/botholomew triage ACME-12`*), and that post's `ts` becomes the thread's
`externalKey`. The key is filled in when the anchor's outbox row is sent, and no reply can be threaded under
a message that does not exist yet. Commands arrive at `webhook:slack-interactivity`. Form bodies carrying
`command=` are commands and those carrying `payload=` are interactions, behind the same signature check.

### The per-project app

Each project connects **its own internal Slack app**, created by a workspace admin from a manifest Botholomew
generates. That makes it the workspace's app, named and governed by its Slack admin, outside Marketplace
review and the commercial-app history rate limit, and routed by its URLs instead of by a guess about the
tenant. The order on the settings page is the order that works:

1. *Generate manifest* (`connection:slack-start`) creates a `pending` `slack` connection with a fresh routing
   token and shows the manifest JSON: the app name and avatar from the default bot, the bot scopes
   (`app_mentions:read`, `channels:history`, `groups:history`, `im:history`, `channels:read`, `groups:read`,
   `chat:write`, `chat:write.customize`, `reactions:write`, `commands`, `users:read`), the event
   subscriptions (`app_mention`, `message.im`, `message.channels`, `message.groups`, `app_uninstalled`,
   `tokens_revoked`), the Messages tab enabled, interactivity, `/botholomew`, and the request URLs
   `…/api/webhook/slack/<routingToken>/events` and `…/interactivity`.
2. The admin creates the app from it. Slack checks the events URL immediately. That first check gets the
   404, because the secret is not known yet, and this is expected.
3. They paste the **signing secret** (shown at once on Basic Information), install the app to the workspace,
   and paste the **bot token**. `connection:slack-activate` probes `auth.test`, records `teamId`, `teamName`, `appId` and
   `botUserId`, and flips the row to `active`.
4. The page tells them to press *Retry* on Slack's Event Subscriptions page, which now passes.

The routing token sits in the clear on the row. It is a router, not a credential (the signature is the
credential), and the manifest must be re-renderable. Both secrets are stored as **one encrypted JSON map**,
`{ botToken, signingSecret }`, in the connection's credential triple, validated by the `slack` connection
definition's Zod schema. Putting the signing secret in refresh-token columns would make the schema lie.
`slack` is not a model kind, `SENSITIVE_KEYS` gains `botToken` and `signingSecret`, and
`no-secrets.test.ts` covers them. A shared app installed by OAuth (*Add to Slack*) remains a future option,
kept open by one rule: everything after the connection row reads a `slack` connection and never asks how it
was created.

## Decisions so far

| Question | Decision |
|---|---|
| Which ToolExec proposal? | B, a thread is a conversation, plus approval cards. Paging (A) and remote control (C) are unphased |
| Who may instruct a bot from Slack? | Linked people who pass `canWriteBot` at that moment. Unlinked people get a note, and nothing is stored |
| Which channels? | DMs always. Channels only once a bot writer has enabled them, which is audited and never MCP. Shared channels are refused |
| Dedupe key | The message (`teamId:channelId:ts`), not `event_id`, so a mention in a followed thread is one turn |
| What reaches Slack? | Final turn text whose causal root is a Slack message in that thread, plus approval cards and templated notes. `send_message` into a remote thread is refused |
| Web composer on Slack threads | Read-only, with *Reply in Slack* |
| Mid-turn progress | An `eyes` reaction, with no text tool |
| Slash commands | One `/botholomew <skill>` command, not one per skill |
| Two secrets | One encrypted JSON map in the existing credential triple |
| Queue for delivery | `bots`, because delivery is the last hop of the turn a person is waiting on; Slack calls get a 10 s timeout |

## Steps

### 1. Schema — `backend/schema/{user_remote_identities,remote_channels,remote_threads,outbox}.ts`

All `serial` PKs and `timestamp(withTimezone)` columns defaulting to `now()`; every tenant row carries
`projectId` with cascade.

| Table | Key columns | Constraints |
|---|---|---|
| `user_remote_identities` | `userId` (cascade), `transport` (`slack` \| `imessage`), `externalId` (Slack `teamId:userId`), `label`, `verifiedAt` | unique `(transport, externalId)`; index `(userId)` |
| `remote_channels` | `projectId`, `connectionId` (→ `project_connections`, cascade), `channelId`, `channelName`, `enabledByUserId` (set null) | unique `(connectionId, channelId)`. Disabling deletes the row; the audit log keeps the history |
| `remote_threads` | `projectId`, `connectionId` (cascade), `transport`, `externalKey` (`teamId/channelId/threadTs`; null only while a slash-command anchor is unsent), `threadId` (→ `threads`, cascade), `channelId`, `identityId` (nullable; iMessage, [phase 17](./phase-0017-imessage.md)), `openedByUserId` (set null), `lastInboundAt`, `lastOutboundAt` | unique `(connectionId, externalKey)`; unique `(threadId)` |
| `outbox` | `projectId`, `connectionId`, `transport`, `kind` (`message` \| `ephemeral` \| `update` \| `status`), `remoteThreadId`, `threadMessageId` (cascade; the body is rendered from this row at send time, never copied), `approvalId`, `template` + `payload` (scrubbed by construction), `recipientExternalId`, `replyToExternalId`, `targetExternalId` (the `ts` to update or react to), `status` (`pending` \| `sending` \| `sent` \| `failed` \| `undeliverable`), `attempts`, `maxAttempts` (1 for `status` rows), `nextAttemptAt`, `claimedAt`, `sentAt`, `externalMessageId`, `error` | index `(status, nextAttemptAt)`; unique `(connectionId, externalMessageId)`; unique `(threadMessageId, connectionId)` where not null, so one bot message is one delivery |

`outbox.id` doubles as the idempotency key where a transport accepts one ([phase 17](./phase-0017-imessage.md)).
`project_connections` gains the `slack` kind, `routingToken` (text, unique, nullable), and `state` (`pending |
active | errored`); Slack metadata is `teamId`, `teamName`, `appId`, `botUserId`, `defaultBotId`.

### 2. Config — `backend/config/remote.ts`

`slackApiBaseUrl` (`SLACK_API_BASE_URL`, default `https://slack.com/api`, which the test stub replaces),
`linkCodeTtlSeconds` (600), `linkAttemptLimit` (5 per 15 minutes), `ingressMaxBodyBytes` (1 MB),
`perIdentityPerMinute` (20), `perThreadPerMinute` (30), `outboxMaxAttempts` (8), `outboxBackoffBaseMs`
(5,000, doubling, capped at 10 minutes), `dispatchFrequencyMs` (30,000), and `slackCallTimeoutMs` (10,000).

### 3. Ops — `backend/messaging/registry.ts`, `backend/ops/{RemoteIdentityOps,SlackOps,OutboxOps}.ts`

- `messaging/registry.ts` holds members `slack` (and `imessage` in phase 17). Each declares
  `verifyInbound(request, connection)`, `parseInbound(body)` into one normalized shape (identity, thread
  key, reply target, text, message key, is-self), `send(row)`, and capabilities (threads, ephemeral, buttons,
  reactions, edits). No call site asks which transport it holds.
- `RemoteIdentityOps`: `mintLinkCode(userId)`, `presentLinkCode(tx, transport, externalId, code)` (single
  use, rate-limited, audited bind), `resolveSender(transport, externalId)`, and `unlink(tx, userId, id)`.
- `SlackOps`: `verifySlackSignature(raw, headers, secret)` (constant time), `renderManifest(connection)`,
  `probe(token)`, `neutralizeMentions(text)`, `renderApprovalCard(approval)`, and `channelIsShared(conn,
  channelId)`.
- `OutboxOps`: `enqueueOutbox(tx, row)` (registers `afterCommit` → `remote:deliver`), `claimOutboxRow(id)`
  (`UPDATE … SET status='sending' WHERE status='pending' AND nextAttemptAt <= now() RETURNING`),
  `deliver(row)` (never throws; classifies outcomes as sent, retry with backoff (honouring `Retry-After` on
  429), or undeliverable), and `causalRootIsRemote(tx, threadMessageId, remoteThreadId)`.

Undeliverable reasons for Slack: `channel_not_found`, `not_in_channel`, `is_archived`, `channel_disabled`,
`account_inactive`. `invalid_auth`, `token_revoked` and `account_inactive` on the bot token mark the
connection `errored`. Its pending rows then wait, and admins get one notification.

### 4. Actions — `backend/actions/{identity,slack,webhook,connection}/*.ts`

| Action | Route | Middleware / RBAC | Audited | MCP |
|---|---|---|---|---|
| `identity:link-start` | `PUT /identity/link` | session | No (Redis only; the bind is audited) | **never** |
| `identity:list` | `GET /identities` | session; own rows only | read | human MCP |
| `identity:delete` | `DELETE /identity` | session; own rows only | yes | human MCP |
| `connection:slack-start` | `PUT /connection/slack` | admin | yes | **never** (arms an ingress) |
| `connection:slack-manifest` | `GET /connection/slack/manifest` | admin | read | human MCP |
| `connection:slack-activate` | `POST /connection/slack`; takes `signingSecret` and `botToken` as `secret()` fields | admin | yes | **never** (a Slack install hop that arms the ingress) |
| `connection:probe` / `connection:delete` | as [phase 5](./phase-0005-bots.md); `probe` re-runs `auth.test` | admin | read / yes | as phase 5 |
| `slack-channel:list` | `GET /slack/channels` | member | read | human MCP |
| `slack-channel:enable` | `PUT /slack/channel` | `canWriteBot` on the default bot | yes | **never** |
| `slack-channel:disable` | `DELETE /slack/channel` | `canWriteBot` or admin | yes | **never** |
| `webhook:slack-events` | `POST /webhook/slack/:routingToken/events`, raw body | signature | machine; decisions audit under their own names | never, by prefix |
| `webhook:slack-interactivity` | `POST /webhook/slack/:routingToken/interactivity`, raw body | signature | as above | never, by prefix |

`AGENTS.md` rule 6's never-MCP list and the `rbac.test.ts` enumeration gain these names in the commit that
adds them.

### 5. Clocks / tasks — `backend/actions/remote/*.ts`

| Task | Queue | Frequency | Notes |
|---|---|---|---|
| `remote:deliver {outboxId}` | `bots` | one-off, from `afterCommit` | Claims, sends, records `externalMessageId` and `sent` in one update; checks an uncertain row's metadata before re-posting |
| `remote:dispatch` | `orchestrator` | 30 s | Claims due `pending` rows (batch 100, `FOR UPDATE SKIP LOCKED`) and enqueues `remote:deliver`; turns rows stuck in `sending` for more than 2 minutes into uncertain retries |

Both are plain `Action`s with `mcp = { tool: false }`. Purging old outbox rows belongs to phase 18's
retention sweep.

### 6. Bot tools — `backend/bots/tools/send-message.ts`

No new tool. `send_message` (`[[ bash equivalent command: write ]]`, replay unsafe) refuses `slack` and
`imessage` targets with a `REMOTE_THREAD` envelope and a next-action hint. The system prompt's thread
section, generated from the registry, tells a bot in a Slack thread two facts: its final text is what the
Slack thread reads, so it should stand alone, and intermediate narration is not seen there.

### 7. Frontend — `frontend/src/pages/{AccountPage,SettingsPage}.tsx`, thread components

- **Account → Linked accounts** has *Link Slack* (shows the code, a countdown, and *DM this to your
  project's Slack app*) and each identity with *Unlink*.
- **Settings → Messaging → Slack** has the four-step connect flow, Test (`auth.test`), the default-bot picker,
  enabled channels with the audience sentence, and Disconnect. Controls are disabled, never absent, for
  non-admins.
- **Thread page** shows a Slack banner with *Open in Slack*, `via Slack · Evan` on each human message, a
  read-only composer, delivery state per bot message (sent, retrying, undeliverable with its reason), and
  the approval's `decided via Slack`.

### 8. CLI — `cli/src/commands/{identity,slack}.ts`

| Command | Calls |
|---|---|
| `botholomew identity link slack` | `identity:link-start`; prints the code and where to send it |
| `botholomew identity list` / `unlink <id>` | `identity:list` / `identity:delete` |
| `botholomew slack connect` | `connection:slack-start`; writes the manifest to stdout or `--out` |
| `botholomew slack manifest` | `connection:slack-manifest` |
| `botholomew slack activate --signing-secret-stdin --bot-token-stdin` | `connection:slack-activate` |
| `botholomew slack channel list\|enable <id>\|disable <id>` | `slack-channel:*` |

### 9. User docs — `frontend/src/content/docs/slack.md`

A new page registered in `sections.ts` covering linking, connecting the app, enabling channels (with the
audience sentence), what bots see and do not see, approvals in Slack, `/botholomew`, the double-post limit,
and disconnecting. Updates go to `security.md` (outside audiences, link direction), `cli.md`, and the threads
page.

### 10. Tests — `backend/__tests__/remote/*.test.ts`

These run against a real server and an isolated database. Slack's Web API is a `Bun.serve` stub
(`__tests__/helpers/fakeSlack.ts`) behind `SLACK_API_BASE_URL`. It records every call and can be told to
return `ratelimited`, `not_in_channel`, `token_revoked`, or a lost response. A `signSlack(body, secret)`
helper drives ingress with real signatures, and the fake model server from phase 6 answers turns.

- `slack-ingress.test.ts`: missing, wrong and stale signatures write nothing and return 401;
  `url_verification` is answered only after a valid signature; an unknown token, a pending connection and a
  disconnected connection return byte-identical 404 bodies.
- `slack-dedupe.test.ts`: one message delivered `cap * 4` times concurrently, and as `app_mention` plus
  `message.channels` with different `event_id`s, yields one `thread_messages` row, one inbox row and one
  turn.
- `slack-routing.test.ts`: a top-level DM opens a thread and is answered under it; a channel mention opens
  a thread; a reply in a followed thread without a mention continues it; a top-level unmentioned message
  writes nothing; a mention in a channel that is not enabled writes nothing and offers *Enable here*; a
  shared channel is refused at enable time and at event time.
- `slack-authority.test.ts`: an unlinked sender writes nothing and gets one note per hour; a linked
  non-writer gets a refusal and no row; a linked writer gets one attributed row with `via: "slack"` and the
  same audit treatment as `message:send`; a removed member's next message is refused with the link
  untouched.
- `identity-link.test.ts`: a code binds exactly the signed identity to exactly the minting user; it is
  single-use, expires, and is ignored in channels; an identity already linked to someone else cannot be
  claimed; attempts are rate-limited; `identity:link-start` is absent from human MCP.
- `slack-output.test.ts`: only the final tool-free text is posted, never interim text; an empty final text
  posts nothing; a delegation report rooted in the Slack thread is delivered; a scheduled turn in the thread
  is not; `send_message` into a Slack thread returns the hinted refusal; `<!channel>` is escaped; long text is
  cut with the link.
- `outbox.test.ts`: the outbox row and the bot message commit together (a forced rollback leaves neither);
  `afterCommit` delivery; `remote:dispatch` picks up a dropped job; 429 honours `Retry-After`; terminal
  errors end `undeliverable`; `token_revoked` marks the connection `errored`; an uncertain row whose
  `outboxId` is found in the stub's thread is marked `sent` without re-posting, and one not found is
  re-posted exactly once.
- `slack-approvals.test.ts`: a card is posted only for Slack-rooted turns; a writer's click decides and is
  audited with `via`; a non-writer's click and an unlinked click change nothing; a click after a web
  decision loses with the decider named; a replayed click is a no-op.
- `slack-commands.test.ts`: `help` lists skills ephemerally; bad arguments return usage and write nothing; a
  valid command creates the thread, the anchor post fills `externalKey`, and the reply threads under it.
- `loops.test.ts`: our echo, another app's `bot_id`, and a second project's app in the same channel create
  no turn.
- `no-secrets.test.ts` and `rbac.test.ts` (extended): the bot token and signing secret never appear in
  audit metadata, logs, prompts or serialized connections; the never-MCP names are asserted by equality.
- `frontend/e2e/slack.spec.ts`: link an identity through a signed stub event and watch the identity appear;
  a Slack thread renders read-only with the via label.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

End to end against a real workspace. Expose the API with a tunnel (`bunx ngrok http 8080`), set
`APPLICATION_URL` to it, and have two Slack users ready (one linked, one not):

1. Settings → Messaging → Slack → *Generate manifest*. Create the app from it in Slack, paste the signing
   secret, install, paste the bot token, and press Retry on Slack's Event Subscriptions page. Test shows the
   workspace name.
2. Account → Linked accounts → *Link Slack*. DM the code to the app. The page shows the identity without a
   reload, and the audit log has `identity:link` with `via: slack`.
3. DM the app *what's in our onboarding notes?* An `eyes` reaction appears, then a threaded answer from
   Botholomew with its avatar. The web thread shows `via Slack · you` and a read-only composer.
4. Invite the app to `#bots-test` and mention it. You get an *Enable here* card. Enable it, reading the
   audience sentence, and mention it again. A thread starts. Reply in the thread without a mention, and the
   bot answers.
5. Ask for something that needs a gated MCP tool. An approval card appears in the thread. Click *Allow once*.
   The card updates, the call runs, and the answer arrives in the same thread.
6. Run `/botholomew help`, then a skill. The anchor post appears and the reply threads under it.

Then the edge cases:

- The unlinked user replies in the followed thread: they get an ephemeral link note, and nothing appears in
  the web thread.
- Post a top-level message in `#bots-test` without a mention. Nothing is stored.
- Remove the linked user's write tag on the web, then reply in Slack. You get an ephemeral refusal naming the
  bot.
- Disable the channel mid-turn. The reply ends `undeliverable: channel_disabled`, and the thread page says
  so.
- Kill the worker between Slack accepting a post and `sent` committing (a debugger breakpoint in
  `remote:deliver`). After restart, the metadata check marks it `sent` and nothing is double-posted.
- Uninstall the app in Slack. The connection shows `errored`, admins are notified, and ingress returns the
  404.

## Definition of done

- [ ] `user_remote_identities`, `remote_channels`, `remote_threads`, `outbox`; `slack` connection kind with routing token, state, and one encrypted secrets map
- [ ] Linking minted in-session and presented by DM; single-use, expiring, rate-limited, audited; `identity:link-start` never MCP
- [ ] Signed ingress verifying before any write; byte-identical 404; message-keyed `requestId`; loop and Slack Connect filtering
- [ ] Three kinds of sender, with authority resolved per message through the same op as `message:send`
- [ ] DMs answer every message; mentions start threads; followed threads need no re-mention; unmentioned top-level messages are never stored
- [ ] Channel enablement audited with the audience sentence, never MCP, re-checked at send time
- [ ] Outbox written in the bot message's transaction; causal-root rule; `remote:deliver` plus `remote:dispatch`; uncertain-post metadata check; the double-post limit documented
- [ ] Approval cards decidable only by people `approval:decide` would allow, audited with `via`
- [ ] `/botholomew` over phase 12's renderer with anchor posts
- [ ] Settings, Account and thread UI; CLI commands; `slack.md` and the doc updates
- [ ] Tests above green, including dedupe under concurrency, the rollback property, and the no-secrets assertions

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
