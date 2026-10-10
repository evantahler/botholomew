# Phase 17 — iMessage

> **Goal:** A person texts their project's number from the Messages app and a bot answers. The conversation
> continues as they text, an inline reply goes back to the exact conversation it answers, and `new` starts a
> fresh one. Approvals are answered with YES or NO. The project never texts anyone who did not text it
> first, and a STOP is honoured on that line forever after.

> **Status: planned, not built.** Stage E — Everywhere. Depends on [phase 16](./phase-0016-slack.md) (identities,
> remote threads, the outbox, the messaging registry), [phase 6](./phase-0006-durable-bot-loop.md),
> [phase 7](./phase-0007-threads-and-web-chat.md), and [phase 10](./phase-0010-mcp-servers-and-approvals.md) for
> approvals.

Slack reaches people at their desks. A phone reaches them everywhere else, and the bots that most need a
person are the ones whose work outlasts a sitting. Apple publishes no iMessage API. [Linq](https://linqapp.com/)
operates that side and exposes a REST API and signed webhooks. ToolExec chose Linq and worked out what the
choice implies in `toolexec:docs/plans/phase-32-remote-interfaces.md`, which never shipped. This phase builds
that half on the foundations [phase 16](./phase-0016-slack.md) lays down: `user_remote_identities`,
`remote_threads`, the `outbox` with `remote:deliver` / `remote:dispatch`, the three kinds of sender, the
causal-root delivery rule, and the messaging registry. All of them gain a second member here.

What iMessage adds is mostly about **consent and shape**. A phone number is personal in a way a Slack user id
is not. A cold text is harassment, and it damages the line's reputation. Linq enforces opt-out per account.
And people text rather than thread, so a chat with a project's number has to behave like one ongoing
conversation that can be reset, with inline replies as the exception. Those three facts produce three new
rules: reach rows, opt-out, and `reply_to` threading.

Out of this phase are group chats and attachments, for the audience reason ToolExec gave and for scope. So is
any fallback to SMS or RCS, in either direction.

## Scope

**In:** a `linq` connection kind (a per-project Linq account and line, with the API key and webhook secret in
one encrypted map); connecting a line provisions its webhook subscription; signed ingress `webhook:linq`
(Standard Webhooks); linking a handle by texting a code to the project's number; `remote_reach` (first-inbound
rows, opt-out per line, the person's current conversation); thread routing by `reply_to` and the current
conversation; `new` and `new @bot`; iMessage-only sends with idempotency keys; undeliverable handling;
approvals answered by reply; a typing indicator; and the UI, CLI and docs for each.

**Out:** group chats and attachments in either direction (unphased). SMS and RCS as channels, including
fallback (settled non-goal). Paging people about work that started on the web, which is the same unphased
fan-out as Slack's. Tapback reactions as answers. Retention of iMessage-originated text, which follows
[phase 18](./phase-0018-operations.md)'s ordinary thread retention.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| ToolExec's Linq decisions | Per-project account and line; provisioned subscription; Standard Webhooks; iMessage only; reach; opt-out 403/2024; idempotency keys; no first-message links | `toolexec:docs/plans/phase-32-remote-interfaces.md` |
| Identities, remote threads, outbox, registry | Linking by code, three kinds of sender, `remote_threads`, `outbox` with `remote:deliver` / `remote:dispatch`, the causal-root rule, `send_message` refusal for remote threads | [phase 16](./phase-0016-slack.md) |
| Ingress discipline | Raw body, byte-identical 404, body cap, rate limits, dedupe before any transcript line | `toolexec:backend/actions/webhook/session-event.ts`, `toolexec:backend/ops/RawRequestOps.ts` |
| Encrypted connections and probes | One definition per kind; probe naming the wrong field | `toolexec:backend/connections/registry.ts`, `toolexec:backend/ops/ConnectionProbeOps.ts`, `toolexec:backend/ops/CryptoOps.ts` |
| Provider calls inside an audited write | Why an external effect sometimes belongs inside the transaction, and how to keep the ledger honest when it does | `toolexec:backend/actions/project/project-delete.ts` |
| The loop and approvals | `requestId` dedupe, human priority, one output channel, `approvals` decided exactly as recorded | [phase 6](./phase-0006-durable-bot-loop.md), [phase 10](./phase-0010-mcp-servers-and-approvals.md) |

## What this must not weaken

1. **A line never cold-texts.** A project's line sends only to a handle that has a reach row for that line,
   which means a handle that texted that number first, and only while it has not opted out. No action, bot
   or schedule can name a phone number to text.
2. **Opt-out is final until the person writes again.** A `STOP` sets `optedOutAt` on that line's reach row.
   The outbox never sends to it, and Botholomew never sends Linq's opt-out override.
3. **A text carries a linked person's authority or none.** It is resolved per message from current
   membership and `canWriteBot`, never from the line or the number.
4. **An SMS or RCS sender is nobody.** The sending network sets that identity and it can be spoofed, so it
   can never present a link code, write a reach row, answer an approval, or instruct a bot.
5. **Postgres first, then the network, and retries are idempotent.** Every send carries the outbox row id as
   Linq's `idempotency_key`, so a retry after a lost response cannot text someone twice.
6. **One output channel, and the project is the boundary.** Only a turn's final text, rooted in this
   person's own message on this line, is delivered, and only in their own 1:1 chat.
7. **Credentials stay server-side and machine ingress stays off MCP.** The Linq key and the `whsec_` secret
   never reach a prompt, code mode, an audit row or a log line. `webhook:linq`, connecting a line, and
   minting a link code are never MCP tools.

## Design

### Each project connects its own Linq account and line

Infrastructure belongs to the project that uses it: model keys, MCP credentials, Slack apps, and now a
number on the project's own Linq bill. `linq` is a connection kind whose encrypted map is `{ apiKey,
webhookSecret }`, the same one-map shape as [phase 16](./phase-0016-slack.md)'s `slack`. Its metadata holds
`lineNumber` (E.164), `subscriptionId`, `payloadVersion`, and `defaultBotId` (the leader unless an admin
picks another). There is no deployment-level Linq configuration at all.

**Connecting a line provisions its webhook**, because Linq creates subscriptions by API and returns the
signing secret exactly once. `connection:linq-connect` does it inside the audited write:

1. Probe the key and confirm the number belongs to that account. If it does not, the error names the field
   that is wrong.
2. List the account's subscriptions and delete any that target this connection's routing URL. A
   half-finished earlier attempt may have left one, and Linq allows a target URL only once per account.
3. Create a subscription for `message.received`, filtered to the number, targeting
   `POST /api/webhook/linq/<routingToken>?version=2026-02-03` (the payload version is pinned).
4. Store the returned `whsec_` secret in the encrypted map, store the subscription id in metadata, and set the
   row `active`.

The network calls happen inside the transaction, each with a 10 s timeout. That is ToolExec's
`project:delete` exception, argued the same way: held to `afterCommit`, the secret would be returned once
into a request with nowhere to store it. If the commit fails after step 3, the orphan subscription targets a
routing token that does not exist. Its first delivery gets the 404, which ends Linq's retries, and step 2 of
the next attempt deletes it. Replacing the key rotates the routing token and recreates the subscription,
because the secret cannot be read back. Disconnecting decrypts the key and reads the subscription id inside
the transaction, deletes the row, and then, in `afterCommit` and on a best-effort basis, uses those values to
delete the subscription. The key is held only in memory, because after commit the row that held it no longer
exists. If that call fails, the 404 ends Linq's retries on the first delivery anyway.

### Linking by texting a code

The direction is [phase 16](./phase-0016-slack.md)'s: **minted in a signed-in session, presented from the
outside identity.** The person presses *Link iMessage* (or runs `botholomew identity link imessage`) and
texts the code to any project's number. The signed `message.received` names the handle, the code names the
person, and one transaction writes the identity (`transport: imessage`, `externalId` = the E.164 handle or
the lowercased Apple ID email, and a masked `label`), the reach row for that line, and the audit row
`identity:link` with `via: "imessage"`. The person starts the conversation, which matters twice. Botholomew
never texts a number someone typed into a form. And Linq refuses a link in the first outbound message of a
chat, but our first outbound message is never the first message of a chat.

### Reach: a line may message only a handle that messaged it

`remote_reach` (`identityId`, `connectionId`, `firstInboundAt`, `lastInboundAt`, `optedOutAt`,
`currentThreadId`) gets a row the first time a verified identity texts that line. The outbox refuses to
claim a message row for a handle without a live reach row, and that check is defence in depth: every
delivery in this phase is already a reply to the person's own message. Reach exists for what comes after
this phase, such as paging, and as the place opt-out lives. A person linked through project A's number has
never texted project B's number, so B cannot reach them. The account page lists each of the person's
projects that has a line, with its number, whether it can reach them yet, and any opt-out: *text anything to
+1 555 0100 to talk to this project's bots on iMessage.*

### Opt-out

Linq enforces opt-out per account. A `STOP` (or another exact keyword) blocks every send from that account
to that person until they write again, and sends return 403 with code 2024. With one account per project,
an opt-out silences one project, so it lives on that line's reach row. Botholomew mirrors Linq in two
places:

- **Inbound keyword.** A message whose whole trimmed text is `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`,
  `END` or `QUIT` (case-insensitive) sets `optedOutAt`. Nothing else is written: no thread message, no turn,
  and no reply.
- **Send refusal.** A send answered with 403/2024 ends the row `undeliverable: opted_out` and sets
  `optedOutAt` if it was not set already.

The person's next non-keyword message clears `optedOutAt` before it is processed, because Linq lifts its
block when they write again and our ledger must agree with Linq's. Botholomew never sends Linq's override for
a courtesy message.

### iMessage only, in both directions

Every send sets `preferred_service: "iMessage"` with no fallback. A send Linq fails because the recipient is
not on iMessage ends `undeliverable: not_imessage`. Inbound, a message whose service is SMS or RCS resolves
to nobody, because the sending network chooses that identity. It writes no identity, no reach row and no
thread message, and it gets **no reply**. This departs from ToolExec, which proposed one reply saying
iMessage is required. Our sends are iMessage-only, so that reply could not reach the person it was for. The
account page states the requirement instead. The consequence, stated plainly, is that a person without
iMessage cannot use this channel.

Group chats are dropped at ingress and get no reply, since a reply would publish to everyone in the group.
Linq does not apply opt-out to groups, which is one more reason. Attachments are not read: the text part is
processed, and the user entry records `[1 attachment not read]` so the bot does not pretend it saw a photo.

### Threads on a phone: `reply_to` and the current conversation

Linq supports inline replies (`reply_to` on send and on inbound messages), so `chatId/originatorMessageId`
is a thread. Its `remote_threads.externalKey` is `chatId/<id of the inbound message that opened it>`, and
`identityId` is set. Every outbound row records Linq's message id in `externalMessageId`, and every inbound
message's id is its `requestId` (`linq:<messageId>`), so both sides of a chat can be looked up. Routing an
accepted inbound message from a linked writer:

1. **An inline reply** goes to the thread of the message it replies to: an outbox row by `(connectionId,
   externalMessageId)`, or else an inbound message by `requestId`. That holds even when another conversation
   is more recent, and the thread becomes current.
2. **A message whose first word is `new`** starts a fresh thread with the line's default bot, or with the bot
   named in `new @slug` if the person may write it. The rest of the text, if any, is the first message. A
   bare `new` gets a templated *New conversation with Botholomew. What's up?* without a model call. The new
   thread becomes current.
3. **Any other message** continues `remote_reach.currentThreadId`, which is the conversation the person most
   recently talked to on this line.
4. **If there is no current thread** (first contact after linking, or the thread was deleted), the message
   starts one with the default bot.

There is no idle expiry. A conversation continues until the person says `new`, which keeps routing
predictable, and [phase 8](./phase-0008-context-management.md)'s compaction keeps a long one affordable. A
plain-text `@slug` mid-conversation routes within the thread by [phase 7](./phase-0007-threads-and-web-chat.md)'s
rules. The only ToolExec rule this drops is "a message beginning with an agent's name starts a session". With
bots named like people, *Botholomew, what's due today?* would open a new conversation every time.

Replies make misrouting obvious. A reply from a bot other than the line's default starts with `[Researcher]`.
The first reply in a thread ends with the thread's web link, which is allowed because it is never the chat's
first message. A reply in a thread that is **no longer current** (say, a delegation report hours later) is
sent as an inline reply to the person's message that started that turn, so it lands visibly in the
conversation it answers. Outbound text is capped at 2,000 characters, cut at a paragraph boundary with the
link, because that is readable on a phone.

### Ingress discipline

`webhook:linq` (`POST /webhook/linq/:routingToken`, raw body) runs in this order and writes nothing before
step 4:

1. Look up the connection by routing token. An unknown token, or a pending, errored or deleted connection,
   returns one byte-identical 404. For Linq that body is also what **stops retries**: Linq retries 5xx and
   429 up to ten times over about twenty-five minutes and retries no other 4xx.
2. Cap the body at 256 KB. Verify the Standard Webhooks signature: HMAC-SHA256 with the base64-decoded
   `whsec_` secret over `{webhook-id}.{webhook-timestamp}.{body}`, compared in constant time against each
   `v1,` entry in `webhook-signature`, with the timestamp within five minutes. A failure returns 401.
3. Drop what is not ours: any event other than `message.received`, `direction: "outbound"` (our own echo),
   group chats, and SMS or RCS service. Each answers 200, so Linq does not retry.
4. Resolve the sender. An unlinked handle presenting a code goes through linking. An unlinked handle sending
   anything else gets one templated note per 24 hours that names no project and no person: *This number
   answers people with a linked Botholomew account. Link yours under Account → Linked accounts.* A linked
   person without `canWriteBot` on the target bot gets a refusal that names what to ask for. Opt-out keywords
   are handled here. Rate limits are per handle (20 a minute) and per line (120 a minute), on top of phase
   6's per-project limits and the pending-inbox cap.
5. Dedupe on `requestId = linq:<messageId>`, phase 6's `(projectId, requestId)` unique index, keyed on the
   message rather than the `webhook-id`, for the same reason Slack keys on `ts`.
6. In one transaction, through the same op `message:send` uses: the thread (if new), the remote thread, the
   reach row's `lastInboundAt` and `currentThreadId`, the attributed `thread_messages` row with `via:
   "imessage"`, the inbox rows, and the audit row. `afterCommit` enqueues `bot:tick`, and the 200 follows.

### Delivery: idempotent, and failures that are answers

Linq's send takes an `idempotency_key`, and the outbox row id is that key. A retry after a lost response
cannot text someone twice, so unlike Slack, iMessage has no double-post window. Classification in
`OutboxOps.deliver`:

| Linq answer | Outcome |
|---|---|
| 2xx | `sent`, with `externalMessageId` recorded in the same update |
| 5xx, network error, 429 (`Retry-After` honoured) | retry with backoff, up to the outbox's max attempts, then `failed` and a notification to the person on the web |
| 403 with code 2024 | `undeliverable: opted_out`; the reach row is flagged |
| recipient not on iMessage | `undeliverable: not_imessage` |
| 401, or 403 on the key | the connection becomes `errored`; pending rows wait; admins get one notification |

### Approvals by reply

There are no buttons on iMessage, so a gated tool call in an iMessage-rooted turn writes a templated
`approval_prompt` outbox row: *Botholomew wants to run linear · create_issue ("Fix login bug"). Reply YES to
allow once or NO to deny. Details: <link>*. The answer is an inline reply to that prompt whose whole trimmed
text is `yes` / `y` / `allow` or `no` / `n` / `deny`. A plain message with those exact words also counts,
but only when the current thread has exactly one open prompt sent to this handle. Anything else is an
ordinary message. *Always allow* is web-only, because a policy change deserves a screen. The decision runs
the same check and op as `approval:decide`, is audited with `via: "imessage"`, and gets a one-line
confirmation. If someone else decided first, the reply says who.

### Typing indicator

When a turn whose causal root is an iMessage leases, a `status` outbox row starts Linq's typing indicator.
The indicator lasts about ninety seconds. The tick's lease-renewal hook, which already runs every 15 s,
refreshes it once 60 s have passed. Each `status` row gets one attempt and is never retried, because a lost
indicator costs nothing and a late one is wrong.

## Settled non-goals

| Not built | Why |
|---|---|
| SMS / RCS fallback | Spoofable sender identity inbound, a different consent regime outbound |
| Group chats | The audience is people nobody chose; Linq does not apply opt-out to groups |
| Attachments | Scope; text-only keeps every outbound message a reply anyone can audit |
| Tapbacks as answers | Ambiguous, and a 👍 on the wrong bubble should not approve a tool call |
| Idle expiry of the current conversation | Predictability; `new` is the reset and compaction bounds the cost |

## Steps

### 1. Schema — `backend/schema/remote_reach.ts`; changes to phase 16's tables

| Table | Key columns | Constraints |
|---|---|---|
| `remote_reach` | `projectId` (cascade), `identityId` (→ `user_remote_identities`, cascade), `connectionId` (→ `project_connections`, cascade), `firstInboundAt`, `lastInboundAt`, `optedOutAt` (nullable), `currentThreadId` (→ `threads`, set null) | unique `(identityId, connectionId)`; index `(connectionId, optedOutAt)` |

`project_connections` gains the `linq` kind (with the routing token and state from phase 16).
`remote_threads.identityId` and `outbox.replyToExternalId` (the `reply_to` message id) come into use, and
`outbox.template` gains `approval_prompt`, `link_note`, `refusal`, `new_conversation` and `linked`. Handles
are personal data: serializers show `label` (masked) to anyone but their owner.

### 2. Config — `backend/config/remote.ts` (extended)

`linqApiBaseUrl` (`LINQ_API_BASE_URL`; the test stub replaces it), `linqPayloadVersion` (`2026-02-03`),
`imessageMaxChars` (2,000), `imessagePerHandlePerMinute` (20), `imessagePerLinePerMinute` (120),
`unlinkedNoteIntervalHours` (24), `typingRefreshMs` (60,000), `linqCallTimeoutMs` (10,000).

### 3. Ops — `backend/messaging/imessage.ts`, `backend/ops/{LinqOps,RemoteReachOps,ImessageRoutingOps}.ts`

- `messaging/imessage.ts` is the registry member. Capabilities: threads (inline replies), typing; no
  ephemeral, no buttons, no edits.
- `LinqOps`: `verifyStandardWebhook(raw, headers, secret)`, `probe(apiKey, lineNumber)`,
  `listSubscriptions`, `createSubscription(conn)`, `deleteSubscription(conn)`, `send(row)` (always
  `preferred_service: "iMessage"`, `idempotency_key: String(row.id)`, optional `reply_to`), and
  `startTyping(chatId)`.
- `RemoteReachOps`: `recordInbound(tx, identityId, connectionId)`, `optOut(tx, …)`, `clearOptOut(tx, …)`,
  `canReach(identityId, connectionId)`, `isOptOutKeyword(text)`.
- `ImessageRoutingOps.resolveThread(tx, inbound, reach)` holds the four routing rules above, as a pure function
  over rows.

### 4. Actions — `backend/actions/{connection,identity,webhook}/*.ts`

| Action | Route | Middleware / RBAC | Audited | MCP |
|---|---|---|---|---|
| `connection:linq-connect` | `PUT /connection/linq`; `apiKey` is a `secret()` field | admin | yes | **never** (arms an ingress) |
| `connection:probe` / `connection:delete` (`linq`) | as [phase 5](./phase-0005-bots.md); `delete` removes the subscription after commit | admin | read / yes | as phase 5 |
| `identity:link-start` (`transport: imessage`) | as phase 16 | session | no | **never** |
| `identity:reach-list` | `GET /identity/reach` | session; own rows only | read | human MCP |
| `webhook:linq` | `POST /webhook/linq/:routingToken`, raw body | signature | machine; decisions audit under their own names | never, by prefix |

`SENSITIVE_KEYS` already covers `apiKey` and gains `webhookSecret`. `no-secrets.test.ts` asserts both.

### 5. Clocks / tasks

No new clock. `remote:deliver` and `remote:dispatch` from [phase 16](./phase-0016-slack.md) gain the
`imessage` member through the registry. The typing refresh rides the tick's lease renewal.

### 6. Bot tools

None. `send_message` already refuses `imessage` threads (phase 16). The generated system-prompt section for
an iMessage thread tells the bot its final text is read on a phone, capped at 2,000 characters, and that a
person can reply inline.

### 7. Frontend — `frontend/src/pages/{AccountPage,SettingsPage}.tsx`, thread components

- **Account → Linked accounts** has *Link iMessage* (the code and *text this to your project's number*), each
  handle masked with *Unlink*, and per project with a line: the number, *can reach you* / *text anything to
  start*, and any opt-out with *text the number to opt back in*.
- **Settings → Messaging → iMessage** has the Linq key and number form, Test, the connected number, the
  default bot, and Disconnect. Controls are disabled, never absent, for non-admins.
- **Thread page** shows `via iMessage · Evan (+1 •••• 0100)` on human messages, a read-only composer, and
  per-message delivery state including `opted_out` and `not_imessage`.

### 8. CLI — `cli/src/commands/{identity,imessage}.ts`

| Command | Calls |
|---|---|
| `botholomew identity link imessage` | `identity:link-start`; prints the code and the numbers to text |
| `botholomew identity reach` | `identity:reach-list` |
| `botholomew imessage connect --number +15550100 --api-key-stdin` | `connection:linq-connect` |
| `botholomew imessage status` / `disconnect` | `connection:probe` / `connection:delete` |

### 9. User docs — `frontend/src/content/docs/imessage.md`

A new page in `sections.ts` covering connecting a Linq line (and that it bills the project's Linq account),
linking a handle, the routing rules (inline reply, `new`, `new @bot`), approvals by YES/NO, STOP and opting
back in, what is not supported (groups, attachments, SMS), and that project members can read these threads.
Updates go to `security.md` (consent and reach), `slack.md` (shared linking), and `cli.md`.

### 10. Tests — `backend/__tests__/remote/*.test.ts`

Linq's API is a `Bun.serve` stub (`__tests__/helpers/fakeLinq.ts`) behind `LINQ_API_BASE_URL`. It
implements subscriptions (returning a `whsec_` secret once and enforcing one subscription per target URL),
send (recording `idempotency_key` and counting distinct sends), and typing. It can inject 5xx, 429, 403/2024,
not-iMessage, and 401. `signLinq(body, secret)` produces real Standard Webhooks signatures.

- `linq-connection.test.ts`: connect probes and creates exactly one subscription filtered to the number and
  targeting the routing URL, and stores the secret encrypted; a number the account does not own is refused
  naming the field; a retry after a simulated failed commit deletes the orphan before creating; replacing
  the key replaces subscription, secret and routing token; disconnect deletes the subscription.
- `linq-ingress.test.ts`: missing, wrong and stale signatures write nothing; unknown, pending and
  disconnected tokens return byte-identical 404 bodies; outbound echoes, group chats and non-`message.received`
  events return 200 and write nothing; one message delivered `cap * 4` times concurrently yields one row and
  one turn.
- `imessage-linking.test.ts`: a code texted over iMessage binds exactly that handle to exactly the minting
  user and writes the reach row; SMS and RCS inbound carrying a valid code write no identity, no reach row
  and no reply; codes are single-use, expiring and rate-limited.
- `imessage-reach.test.ts`: the outbox refuses a handle with no reach row; a handle's first text writes it; an
  opt-out on project A's line leaves project B's line able to send; `STOP` writes nothing but `optedOutAt`;
  the next message clears it; a 403/2024 ends `undeliverable` and flags the row.
- `imessage-routing.test.ts`: a plain message continues the current thread; an inline reply reaches its own
  thread even when another is more recent, and makes it current; `new` and `new @slug` start threads that
  become current; a bare `new` makes no model call; a reply from a non-default bot carries its name; a late
  reply in a non-current thread is sent with `reply_to`.
- `imessage-outbox.test.ts`: every send carries `preferred_service: "iMessage"` and no fallback; a retry after
  a dropped response reuses its idempotency key and the stub counts one send; 429 honours `Retry-After`;
  not-iMessage ends `undeliverable`; 401 marks the connection `errored`.
- `imessage-approvals.test.ts`: an inline YES decides and is audited with `via`; a plain YES decides only with
  exactly one open prompt; `maybe` is an ordinary message; a non-writer's YES changes nothing; a late YES
  names the earlier decider.
- `no-secrets.test.ts` and `rbac.test.ts` (extended): the Linq key and webhook secret appear nowhere; the
  never-MCP names are asserted by equality.
- `frontend/e2e/imessage.spec.ts`: link a handle through a signed stub event; the account page shows the
  project as reachable; an opt-out appears after a `STOP` event.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

End to end with a real Linq sandbox line, the API exposed through a tunnel, and a phone signed in to
iMessage:

1. Settings → Messaging → iMessage: paste the Linq key and the line's number. Test passes, and Linq's
   dashboard shows one subscription pointing at the tunnel.
2. Account → Linked accounts → *Link iMessage*. Text the code to the number. A *Linked* reply arrives, and
   the account page shows the project as reachable.
3. Text *what's on the roadmap this week?* A typing indicator appears, then the answer. The web thread shows
   `via iMessage` and a read-only composer.
4. Text *new @researcher find three competitors*. The reply starts `[Researcher]`. Then inline-reply to
   Botholomew's earlier answer. That reply lands in the first conversation.
5. Ask for something behind an approval gate. Inline-reply YES to the prompt. The tool runs, and the audit
   log shows `approval:decide` via iMessage.

Then the edge cases:

- Text `STOP`. Nothing is answered, and the account page shows the opt-out. Text anything else and you are
  reachable again.
- Send from a phone with iMessage turned off (SMS). Nothing is written and nothing is sent back.
- Add the number to a group chat and write there. Nothing is written.
- Kill the worker mid-send (a breakpoint after Linq's 200). After restart the retry reuses the key, and the
  phone shows one message.
- Disconnect the line. Linq's dashboard loses the subscription, and a delivery replayed with the old URL
  gets the 404.

## Definition of done

- [ ] `linq` connection kind with one encrypted map, provisioned subscription, orphan cleanup, and routing-token rotation on key replacement
- [ ] `webhook:linq` verifying Standard Webhooks before any write; byte-identical 404; message-keyed `requestId`; echo, group and SMS/RCS filtering
- [ ] Linking by texted code; SMS/RCS can never link
- [ ] `remote_reach` with first-inbound rows, per-line opt-out mirrored from keywords and 403/2024, and the current conversation
- [ ] Routing by `reply_to`, `new`, `new @bot`, and the current conversation; bot-name prefixes; late replies inline
- [ ] iMessage-only sends with the outbox id as idempotency key; undeliverable reasons surfaced
- [ ] Approvals by YES/NO reply, audited with `via`; *Always allow* web-only
- [ ] Typing indicator on lease, refreshed by renewal, single-attempt
- [ ] Account, settings and thread UI; CLI; `imessage.md` and doc updates
- [ ] Tests above green against the fake Linq server

## Commands

```bash
botholomew imessage connect --number +15550100 --api-key-stdin < linq-key.txt
botholomew identity link imessage      # prints a code; text it to +1 555 0100
botholomew identity reach              # which projects' lines can reach you, and any opt-outs
```

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
