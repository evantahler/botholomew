# Phase 15 — TUI and CLI publishing

> **Goal:** `botholomew chat` opens a live conversation with any bot in a project, right in the terminal:
> streamed replies, tool calls as they happen, queue and steer, slash-command skills, and inline approvals.
> Anyone can install the CLI in one line — `botholomew@2.x` from npm, or a standalone binary through an
> install script — sign in through the browser, and keep it current with `botholomew upgrade`.

> **Status: planned, not built.** Stage E — Everywhere. Depends on [phase 1](./phase-0001-clean-slate-and-shell.md),
> [phase 7](./phase-0007-threads-and-web-chat.md), [phase 10](./phase-0010-mcp-servers-and-approvals.md),
> [phase 12](./phase-0012-skills.md), and [phase 13](./phase-0013-leader-and-workers.md).

The CLI is not new in this phase. Commands ship with every phase, because the product CLI tracks the HTTP
surface (rule 15 in [AGENTS.md](../../AGENTS.md)). The earlier phases ship `botholomew memory …`,
`bot …`, `thread …`, `task …`, and `schedule …`, all as thin HTTP clients copied from ToolExec's shell.
What they lack is three things. They have no interactive client. Only one of them is live:
[phase 7](./phase-0007-threads-and-web-chat.md)'s `thread follow` has a small socket client
(`cli/src/socket.ts`), while `thread send --wait` ([phase 6](./phase-0006-durable-bot-loop.md)) and the other
followers still poll, as ToolExec's `follow.ts` does. And there is no way to get them onto anyone's machine.
This phase adds those three, and nothing else.

The TUI comes from v1. [docs/field-notes.md](https://github.com/evantahler/botholomew/blob/v1/docs/field-notes.md)
says it plainly: "TUIs are hard, and worth it" — Ink and React in a terminal, redrawing on resize, a message
queue, streaming output, tool-call visualization, at "far more than a 'reasonable' share of the total effort".
That effort lives in [src/tui/](https://github.com/evantahler/botholomew/tree/v1/src/tui), and this phase ports
it rather than redoing it. What changes underneath is total. v1's TUI drove an agent loop running in the same
process ([src/chat/session.ts](https://github.com/evantahler/botholomew/blob/v1/src/chat/session.ts)). The 2.0
TUI is a pure client: it sends messages through the same actions the web composer uses, and it watches the same
channels.

**Clean break.** [Phase 1](./phase-0001-clean-slate-and-shell.md) removes the old `install.sh` and the v1
release pipeline. Nothing on `main` builds, serves, or links to v1 assets. v1 lives on, unchanged, on
the [`v1` branch](https://github.com/evantahler/botholomew/tree/v1). This phase ships the first artifacts of the
new line, and it has to do so without silently capturing the people still running v0.27.

## Scope

**In:**

- **The TUI.** `botholomew chat`, built on Ink 7 and React 19, with Chat, Threads, Tasks, Approvals, and Help
  tabs ported from v1's components.
- **Live updates over WebSocket.** One client shared by the TUI and every `--follow`, falling back to polling.
- **Browser login.** A device-code flow with revocable, refreshable CLI sessions; `--with-password` remains
  for CI and tests.
- **Packaging.** npm `botholomew@2.x`, published with OIDC trusted publishing and provenance under the
  `next`, `latest`, and `v1` dist-tags; a Bun launcher; standalone binaries for five targets with
  `SHA256SUMS`; an install script at `www.botholomew.com/install.sh`.
- **Updates.** `botholomew upgrade`, a daily version check, and a server-advertised minimum CLI version.
- **v1 users.** A one-time notice for anyone who had v1 installed.
- **Release and verification.** `release-cli.yml`, tests, and user docs.

**Out:**

- **Install paths this phase does not build.** No Windows install script — the `.exe` and npm cover Windows —
  and no Homebrew tap. Both are unphased.
- **Long-lived credentials for CI.** Personal access tokens are unphased; `--with-password` covers CI.
- **Memory and bot editing in the TUI.** The web UI and `memory pull/push` own those.
- **v1's Tools, Context, Workers, and Schedules tabs.** The web pages and `schedule …` replace them.
- **Slack and iMessage** ([phase 16](./phase-0016-slack.md), [phase 17](./phase-0017-imessage.md)).
- **Any local-agent mode.** That is v1.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| ToolExec CLI shell (copied in phase 1) | Commander program; `apiRequest`, which checks Keryx's error envelope as well as the status; XDG config at mode 0600; `--url` > env > file > default; `--json`; palette | `toolexec:cli/src/client.ts`, `toolexec:cli/src/config.ts`, `toolexec:cli/src/context.ts`, `toolexec:cli/src/output.ts`, `toolexec:cli/src/palette.ts` |
| ToolExec follow | An `afterId` cursor polled every 500 ms, with SIGINT sending cancel — the loop this phase replaces with a socket | `toolexec:cli/src/follow.ts`, `toolexec:docs/plans/phase-17-product-cli.md` |
| ToolExec live socket | `createChannelRegistry`, which ref-counts channels and defers the last unsubscribe; 1 s → 30 s reconnect backoff; subscribe, then hydrate; the Keryx frame-ordering defect; "CLI `--follow` still polls" | `toolexec:frontend/src/context/LiveSocketContext.tsx`, `toolexec:docs/plans/phase-18-dashboard-websockets.md` |
| ToolExec publishing | OIDC trusted publishing with no `NPM_TOKEN`, skipping any version already on the registry; a CLI bundle; a package-shape test; CLI tests that run the binary against a booted server | `toolexec:.github/workflows/publish-cli.yml`, `toolexec:cli/scripts/build.ts`, `toolexec:cli/__tests__/package.test.ts`, `toolexec:backend/__tests__/cli/cli.test.ts` |
| ToolExec sessions | `session:create` (email and password, the same message for every failure), a one-day session TTL, and an OAuth server that serves `/mcp` | `toolexec:backend/actions/session.ts`, `toolexec:backend/config/session.ts`, `toolexec:backend/__tests__/oauth/redirect-loopback.test.ts` |
| v1 TUI | The app shell, message list, input bar, queue panel, tool-call boxes, slash popup, status bar, link picker, and inline approval prompt | [src/tui/App.tsx](https://github.com/evantahler/botholomew/blob/v1/src/tui/App.tsx), [src/tui/components/](https://github.com/evantahler/botholomew/tree/v1/src/tui/components) |
| v1 markdown renderer | `Bun.markdown.ansi`, plus the long-URL fix (#282): URLs are masked with sentinels and spliced back whole, rather than getting newlines baked in at column 80. Tables are pre-rendered to fit the width | [src/tui/markdown.ts](https://github.com/evantahler/botholomew/blob/v1/src/tui/markdown.ts), [src/tui/links.ts](https://github.com/evantahler/botholomew/blob/v1/src/tui/links.ts), [src/tui/markdownTables.ts](https://github.com/evantahler/botholomew/blob/v1/src/tui/markdownTables.ts), [test/tui/markdown.test.ts](https://github.com/evantahler/botholomew/blob/v1/test/tui/markdown.test.ts) |
| v1 input pieces | Slash completion, the message queue hook, and resize redraw | [src/tui/slashCompletion.ts](https://github.com/evantahler/botholomew/blob/v1/src/tui/slashCompletion.ts), [src/tui/hooks/useMessageQueue.ts](https://github.com/evantahler/botholomew/blob/v1/src/tui/hooks/useMessageQueue.ts), [src/tui/hooks/useResizeRedraw.ts](https://github.com/evantahler/botholomew/blob/v1/src/tui/hooks/useResizeRedraw.ts), [docs/tui.md](https://github.com/evantahler/botholomew/blob/v1/docs/tui.md) |
| v1 distribution | Compiled binaries (most of [scripts/build.ts](https://github.com/evantahler/botholomew/blob/v1/scripts/build.ts) stages DuckDB and ORT WASM), the install script, an `upgradr` updater, and an npm publish with `--provenance` | [install.sh](https://github.com/evantahler/botholomew/blob/v1/install.sh), [src/update/updater.ts](https://github.com/evantahler/botholomew/blob/v1/src/update/updater.ts), [src/commands/upgrade.ts](https://github.com/evantahler/botholomew/blob/v1/src/commands/upgrade.ts), [.github/workflows/auto-release.yml](https://github.com/evantahler/botholomew/blob/v1/.github/workflows/auto-release.yml) |
| Live channels and messaging | Content-free `project:<id>:thread:<id>` and `…:bot:<id>` frames; token deltas on the read-authorized `…:thread:<id>:stream`; `cli/src/socket.ts` and `thread follow`; `message:send` with `whenBusy: follow_up \| steer`; `thread send --wait`; `conversation:stop` | [phase 6](./phase-0006-durable-bot-loop.md), [phase 7](./phase-0007-threads-and-web-chat.md) |
| Approvals, skills, and tasks | `approval:approve` (`--always bot\|project`) and `approval:deny`; `skill:list`, `skill:render`, `skill:run`; the task list and tree | [phase 10](./phase-0010-mcp-servers-and-approvals.md), [phase 12](./phase-0012-skills.md), [phase 13](./phase-0013-leader-and-workers.md) |

## What this must not weaken

1. **The CLI tracks HTTP.** The TUI calls the actions the web app calls. The only server surfaces this phase
   adds are sign-in, CLI sessions, and one field on `status` — general authentication, not TUI features.
2. **The socket is an accelerant.** Every view hydrates over HTTP and reads again from its cursor after a
   reconnect. A dead socket degrades to polling, never to silence.
3. **A credential is minted only by a person's decision.** Approving a CLI login is an audited action in the
   browser. A CLI session can be revoked. Secrets on disk live in a file with mode 0600, and the device code
   is never displayed.
4. **Every message from the terminal is that person's message.** It goes through the same actions as the
   web, with the same attribution and the same audit.
5. **No new read path.** Token deltas reach the TUI only on the stream channel, whose `authorize()` already
   checks that the person can read the thread.
6. **v1 is left alone.** The 2.x client never reads or writes v1 project directories, and touches
   `~/.botholomew` only to detect that it exists.
7. **Publishing never surprises a v1 user.** No 0.x semver range ever resolves to 2.x. `latest` moves only at
   2.0.0 stable, and nothing that resolves "latest" moves before then.

## Design

### Signing in from a terminal

The CLI that [phase 1](./phase-0001-clean-slate-and-shell.md) copies from ToolExec logs in with an email and
password and stores the `__session` cookie. That stays as
`--with-password`, reading the password from stdin, for CI and for the test suite. As the default it has
three problems. A password is the wrong thing to type into a terminal on a shared machine. It cannot work for
an SSO-only account. And a session dies after the one-day TTL, which kills a TUI left open overnight.

Keryx's OAuth server, with loopback redirects, is the obvious alternative, and we pass on it. The tokens it
issues authenticate `/mcp`, while every HTTP action the CLI calls reads the session cookie, so reusing them
would mean teaching every route a second credential. A loopback listener also fails over SSH and inside
containers.

`botholomew login` is therefore a **device-code flow** in the shape of RFC 8628:

1. **`cli-login:start`** returns three things:
   - a `deviceCode` — 32 random bytes, of which only `sha256` is stored, and which the CLI never prints;
   - a `userCode` such as `WDJB-MJHT`, drawn from an alphabet with no ambiguous characters;
   - `verificationUri` and `verificationUriComplete`.

   It also records the CLI's hostname, OS, version, and IP. The code expires after 10 minutes.
2. **The CLI opens the browser** at `/cli-login?code=WDJB-MJHT`, or prints the URL when there is no display,
   and polls `cli-login:poll` every 5 s.
3. **The signed-in person sees who is asking:** "A CLI on `evan-mbp` (macOS, botholomew 2.1.0, 203.0.113.4)
   asked to sign in as you, 40 seconds ago." They approve or deny.
4. **The next poll returns the credentials, exactly once.** That poll gets a `__session` cookie for this
   person, plus a **refresh token**. The login is consumed, so a second poll is `expired_token`. Polling faster
   than the interval is `slow_down`.

The login also creates a `cli_sessions` row. Keryx sessions stay ordinary one-day sessions. When a request
gets `401 session not found`, the CLI exchanges its refresh token through `cli-session:refresh` for a new
cookie and a new refresh token. The refresh token is rotated on every use and slides 30 days. Presenting a
token that has already been rotated revokes the whole CLI session, because a token that turns up twice has
been copied. Account → **Signed-in CLIs** lists sessions by hostname and last use, and revoking one deletes
both the refresh hash and the live Redis session.

Config lives at `$XDG_CONFIG_HOME/botholomew/config.json`, mode 0600, holding `baseUrl`, `sessionCookie`,
`refreshToken`, and `project`. This is deliberately not v1's `~/.botholomew/`.

### One live client for `--follow` and the TUI

Phase 7's `cli/src/socket.ts` grows into `cli/src/live/`, which holds the socket, a channel registry, and a
cursor reader. Every follower and the TUI then use the same client.

**The socket.** There is one WebSocket per process, on the same endpoint the web app uses, carrying the
session cookie as a header on the upgrade. Bun's `WebSocket` accepts headers.

**The registry.** `createChannelRegistry` is ported as-is, so a remount never sends
subscribe → unsubscribe → subscribe in one turn. Keryx can apply those frames out of order and leave the client
deaf (`toolexec:docs/plans/phase-18-dashboard-websockets.md`).

**The reader.** Every follower does the same things in the same order:

1. Subscribe to `project:<id>:thread:<id>`, plus `:stream` when it displays deltas.
2. Hydrate from the HTTP cursor (`afterId`).
3. On each frame, read again from the cursor. Pings that arrive mid-read are unioned into the next read
   rather than dropped — ToolExec's `pendingKinds` lesson.
4. Reconnect with backoff from 1 s to 30 s, with jitter, and hydrate again on reconnect.

**Fallback.** After three failed upgrades, or when a proxy refuses the upgrade, the reader polls every 2 s.
The status bar says `polling`, and the reader retries the socket every 60 s.

**Exits.** `thread follow` runs until Ctrl+C. `task view --follow` exits when the task settles.
`thread send --wait` exits when the conversation the message woke goes idle — the same condition phase 6
polls for, now observed from the bot channel. `schedule test --follow` follows the run's thread until its root
task settles. With `--json`, output is JSONL.

### `botholomew chat`

```
botholomew chat [--bot <slug>] [--thread <id> | --new] [--project <id|slug>]
```

By default it talks to the leader, in the newest thread you wrote in with that bot. It keeps v1's tab
shortcuts, so muscle memory carries over:

| Tab | Key | What it shows |
|---|---|---|
| Chat | `Ctrl+a` | The thread. Messages from people and bots, each with its author: 2.0 threads are multi-party, and v1's are one-to-one. The bot's streaming text sits in a live block, and the posted final message replaces it. Tool calls render as v1's folded `ToolCall` boxes, driven by `tool_calls` rows. `event` entries — task settled, schedule fired, reminder — appear as dim system lines |
| Threads | `Ctrl+e` | Your threads with this bot and the others you can read. Enter switches to one |
| Tasks | `Ctrl+t` | Open tasks as an ASCII tree, read-only. Enter opens the task's thread in Chat |
| Approvals | `Ctrl+p` | Pending approvals on bots you can write, through `approval:approve` / `approval:deny` ([phase 10](./phase-0010-mcp-servers-and-approvals.md)). `y` allow once, `a` always allow for this bot, `n`/`Esc` deny, as in v1 |
| Help | `Ctrl+g` | Keys, connection state, and versions |

Several v1 pieces port nearly as they are:

- **Markdown rendering**, including the long-URL fix and the table pre-render.
- **The link picker** (`Ctrl+L`).
- **`useResizeRedraw`.**
- **Inline `ApprovalPrompt`**, for a gated call in the current thread.
- **The slash popup.** It lists the project's skills from `skill:list` plus the built-ins `/new`, `/bot`,
  `/threads`, `/link`, `/help`, and `/quit`. Argument hints and the preview come from `skill:render`, and
  Enter calls `skill:run`, exactly as the web composer does ([phase 12](./phase-0012-skills.md)). Rendering
  happens only on the server.
- **An `@` popup**, which is new and reuses the same completion component, completes bot names for routing
  ([phase 7](./phase-0007-threads-and-web-chat.md)).

The status bar shows the project, the bot, the bot's status (including "sleeping until 14:00", which replaces
v1's `SleepProgress` bar now that sleeping is durable), its model, the queue count, and `live`, `polling`, or
`reconnecting`.

### The queue lives on the server now

In v1 the queue is "ephemeral (in-memory, not persisted)". The TUI holds messages until the agent finishes,
and `Ctrl+E` / `Ctrl+X` edit or drop them. In 2.0, Enter while the bot is busy sends the message straight
away with `whenBusy: follow_up`. It becomes an inbox row that survives the terminal closing, and the TUI shows
it dimmed until a tick claims it.

`Esc` sends the current input as a `steer`. Pressing `Esc` twice on an empty input calls
`conversation:stop`. That is phase 6's "stop is not steer": it aborts the in-flight step, where a steer only
redirects the next one. It is the terminal's form of the "Stop now" message
[Grok Bot](https://docs.x.ai/grok-bot/chat-and-collaboration) suggests. Editing and withdrawing a queued
message do not survive: a queued message has already been delivered, and correcting it is a steer. So
`useMessageQueue` becomes a view of server state, not a store.

### Runtime: Bun, with a launcher

ToolExec bundles its CLI for Node. We do not, and the reason is the renderer. v1's markdown output is built on
`Bun.markdown.ansi`, and both the long-URL fix and the table pre-render are workarounds tuned to exactly that
renderer's behaviour. Swapping it for a Node renderer means re-earning #282.

v1 already requires Bun for npm installs (`bun install -g botholomew`), and the standalone binary embeds Bun
for everyone else. The npm package's `bin` is a small launcher written so Node can run it:

- under Bun, it imports the bundle;
- under Node, it re-executes with `bun` if one is on `PATH`;
- otherwise it prints how to install Bun or the binary and exits 1, instead of `env: bun: No such file or
  directory`.

### Binaries without natives

v1's [scripts/build.ts](https://github.com/evantahler/botholomew/blob/v1/scripts/build.ts) is mostly about
natives: it externalizes five DuckDB binding packages, stages a roughly 112 MB `libduckdb`, and rewrites
`import.meta.resolve` for the ORT WASM files. The 2.0 client has none of that — Ink, React, Commander, and
Chalk are pure JS — so a single command builds each target:

```
bun build --compile --minify --target=bun-<os>-<arch> cli/src/index.ts --outfile dist/botholomew-<os>-<arch>[.exe]
```

That covers five targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, and `windows-x64`.

- **Building.** All five cross-compile on one Ubuntu runner. A macOS job ad-hoc signs the darwin files
  (`codesign --force --sign -`), because Apple Silicon does not run unsigned code.
- **Smoke tests.** One job each on macOS, Linux, and Windows runs `--version` and `chat --help`, and renders
  one TUI frame against a fixture.
- **Checksums.** `SHA256SUMS` ships beside the binaries.

### Versions, dist-tags, and the v1 line

v1 publishes `botholomew@0.x` to npm under `latest`. [Phase 1](./phase-0001-clean-slate-and-shell.md) leaves the
2.x package `"private": true` and names the question this phase must answer before flipping it: what does a
v1 user's `botholomew upgrade` do? The 2.0 plan:

1. **Before the first 2.x publish,** add a `v1` dist-tag pointing at 0.27.3. `bun add -g botholomew@v1` then
   restores v1 at any time.
2. **Prereleases** (`2.0.0-alpha.N`, `-beta.N`) publish under the `next` dist-tag. Their GitHub releases are
   marked prerelease, so `releases/latest` still resolves to v0.27.3.
3. **2.0.0 stable** moves `latest`.

Semver protects dependency ranges: `^0.27` and `~0.27` never resolve to 2.x. It does **not** protect commands
that ask for "latest", and two of those are in the field:

- **v1's `botholomew upgrade`**, through `upgradr`.
- **v1's binary update path**, which downloads `releases/latest/download/botholomew-<os>-<arch>`.

After 2.0.0, a v1 user who runs `upgrade` gets the 2.x client. We keep the same asset names anyway, so the
upgrade succeeds rather than failing with a missing file. On its first run, 2.x detects v1's home directory
(`HOME_CONFIG_DIR` in [src/constants.ts](https://github.com/evantahler/botholomew/blob/v1/src/constants.ts))
and prints a one-time notice: this is the client for the hosted service; your v1 projects are untouched on
disk; `bun add -g botholomew@v1` or the v0.27.3 release takes you back. Before 2.0.0 ships, the release
checklist runs v0.27.3's `upgrade` against a staging release, to confirm what `upgradr` actually does across a
major version.

### Install and upgrade

**The install script.** `frontend/public/install.sh` is served at `https://www.botholomew.com/install.sh` (the
domain from [phase 2](./phase-0002-deployment.md)). It is new, not v1's. It:

1. resolves the version from the npm dist-tag (`latest` by default, or `--channel next`), so one source of
   truth picks the version for both install paths;
2. downloads `botholomew-<os>-<arch>` and `SHA256SUMS` from that version's GitHub release;
3. verifies the checksum with `sha256sum` or `shasum -a 256`, which v1 never does;
4. installs `botholomew` plus the `bothy` alias into `$BOTHOLOMEW_BIN_DIR`, defaulting to `~/.local/bin`.

**`botholomew upgrade`.** This ports v1's `upgradr` binding, configured with the package `botholomew`, the
repo, the binary name, and the XDG cache directory. The variable `BOTHOLOMEW_NO_UPDATE_CHECK` disables the
check. The installed channel is remembered, so a `next` install upgrades along `next`. If `upgradr` cannot
follow a dist-tag, the fix goes upstream into `upgradr`; we do not fork its logic.

**The minimum version.** `status` reports `cli.minimumVersion`, from `CLI_MINIMUM_VERSION`, unset by default.
The CLI checks it at login and then at most daily. Below the minimum, every command except `upgrade`,
`logout`, and `--version` refuses, with a one-line hint.

## Steps

### 1. Schema — `backend/schema/{cli_logins,cli_sessions}.ts`

| Table | Key columns | Constraints |
|---|---|---|
| `cli_logins` | `deviceCodeHash`, `userCode`, `status` (`pending \| approved \| denied \| consumed \| expired`), `userId` (set on approval), `clientHostname`, `clientOs`, `clientVersion`, `clientIp`, `expiresAt`, `lastPolledAt`, `createdAt` | Unique `deviceCodeHash`; unique partial `userCode WHERE status = 'pending'`; `userId` → `users`, cascade |
| `cli_sessions` | `userId`, `label` (the hostname), `refreshTokenHash`, `previousRefreshTokenHash`, `sessionId` (the live Redis session), `clientVersion`, `lastUsedAt`, `expiresAt`, `revokedAt`, `createdAt` | Unique `refreshTokenHash`; index `(userId, revokedAt)`; `userId` → `users`, cascade |

`cli_sessions` is user-scoped and carries no `projectId`, the same reasoning ToolExec's notifications use: a
credential belongs to a person, not a project.

### 2. Config — `backend/config/cli.ts`

| Key | Default |
|---|---|
| `loginTtlMs` | 10 min |
| `pollIntervalMs` | 5 s |
| `refreshTtlMs` | 30 days, sliding |
| `minimumVersion` | `CLI_MINIMUM_VERSION`, unset |
| `startRateLimit` | per IP |

### 3. Ops — `backend/ops/CliLoginOps.ts`

- `startLogin(meta)` → `{ deviceCode, userCode, … }`. It stores only the hash.
- `approveLogin(userId, userCode, decision)` — approves or denies.
- `pollLogin(deviceCode, connection)` → a status, or, exactly once, a session bound to the connection plus a
  refresh token.
- `refreshCliSession(token, connection)` — rotates the token, and revokes the whole session when an old token
  is reused.
- `revokeCliSession(userId, id)` — clears the refresh hash and destroys the Redis session.

### 4. Actions — `backend/actions/{cli-login,cli-session}/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `cli-login:start` | `PUT /cli-login` | `RateLimitMiddleware` | — | never |
| `cli-login:view` | `GET /cli-login` | `SessionMiddleware`; returns the request's metadata for the approval page | — | never |
| `cli-login:approve` | `POST /cli-login/approve` | `SessionMiddleware`; approve or deny | yes, with hostname and IP | **never** |
| `cli-login:poll` | `POST /cli-login/poll` | rate limit per device code; `deviceCode` is a `secret()` | — | never |
| `cli-session:refresh` | `POST /cli-session/refresh` | `RateLimitMiddleware`; the refresh token is a `secret()` | — | never |
| `cli-session:list` | `GET /cli-sessions` | `SessionMiddleware`; the caller's own sessions only | — | yes |
| `cli-session:revoke` | `POST /cli-session/revoke` | `SessionMiddleware`; the caller's own sessions only | yes | no |
| `status` (extended) | `GET /status` | — | — | as before |

`cli-login:approve` is never an MCP tool, because an OAuth client acting for a person must not be able to mint
a long-lived credential. `cli-session:refresh` goes on the closed list of unaudited machine writers: it renews
a credential a person has already approved, and the approval was audited. `rbac.test.ts` names the
`cli-login:*` and `cli-session:refresh` actions in its never-MCP list.

### 5. Clocks — `backend/actions/cli-login/cli-logins-sweep.ts`

`cli-logins:sweep` is task-only and runs daily on `default`. It deletes logins that are expired or consumed
and older than a day, and `cli_sessions` that are revoked or expired and older than 30 days.

### 6. Frontend — `frontend/src/pages/CliLoginPage.tsx`, Account, `frontend/public/install.sh`

- **`/cli-login`** prefills the code, shows the requester's metadata, and offers Approve and Deny. It is
  behind `ProtectedRoute`, so a signed-out person signs in first and lands back on the page.
- **Account → Signed-in CLIs** lists sessions by hostname, version, and last use, with Revoke.
- **`install.sh`** is the script described above. It is served as `text/plain` by the frontend's nginx.

### 7. CLI — `cli/src/{live,tui,update}/*`, `cli/src/commands/{auth,chat,upgrade}.ts`

| Command | What it does |
|---|---|
| `botholomew login [--url] [--no-browser]` | Runs the device flow. It prints the code and URL, opens the browser unless `--no-browser`, polls, and saves the cookie and refresh token |
| `botholomew login --with-password --email <e>` | Reads the password from stdin and calls `session:create` (ToolExec's flow) |
| `botholomew logout` / `whoami` | `session:destroy` plus `cli-session:revoke` for this session / `me:view` |
| `botholomew auth sessions` / `auth revoke <id>` | `cli-session:list` / `cli-session:revoke` |
| `botholomew chat [--bot] [--thread \| --new]` | The TUI |
| `botholomew thread follow <id>`, `thread send … --wait`, `task view <id> --follow`, `schedule test <id> --follow` | All four move onto the live reader. The command names are unchanged from the phases that add them |
| `botholomew upgrade` / `botholomew --version` | `upgradr`; reports the channel and the server's minimum |

The port of v1's `src/tui/` is copied file by file. Its imports are rewritten from the in-process `ChatSession`
to an `ApiThreadSession` built on `client.ts` and `live/`. `cli/src/tui/markdown.ts`, `links.ts`,
`markdownTables.ts`, `slashCompletion.ts`, and the components keep their v1 names, so the history across the
branch boundary stays legible.

### 8. Build and release — `cli/scripts/{build,build-binary}.ts`, `.github/workflows/release-cli.yml`

**Build scripts.**

- `build.ts` writes `dist/botholomew.js`, a Bun-target bundle, and `dist/launcher.js`. The `botholomew` and
  `bothy` bins move from `dist/botholomew.js` to the launcher.
- `build-binary.ts --target=bun-<os>-<arch>` writes one compiled file.
- `cli/package.json` drops phase 1's `"private": true` in the same commit that adds the workflow, and no
  earlier. `package.test.ts` asserts the flag is absent only once `release-cli.yml` exists, so the two can
  never land apart.

**`release-cli.yml`** runs on pushes to `main` that touch `cli/**` (or the workflow file), and on
`workflow_dispatch`. Its jobs:

1. **check** — does the npm version from `cli/package.json` already exist? If so, the run is a no-op, as in
   ToolExec.
2. **binaries** — cross-compiles on Ubuntu, then signs and smoke-tests on macOS, Linux, and Windows.
3. **release** — creates a *draft* GitHub release `v<version>` (marked prerelease if the version contains `-`)
   and uploads the binaries and `SHA256SUMS`.
4. **npm** — `permissions: id-token: write`, then `npm publish --provenance --tag <next|latest>`. The repo is
   public, so provenance works; ToolExec needs `--no-provenance` only because its repo is private.
5. **publish** — undrafts the release.

The order matters. The install script resolves the version from npm, so npm moves only after the assets
exist. A failed npm publish leaves the release a draft that nothing points at.

**Manual steps.** npm's trusted publisher for `botholomew` must name `release-cli.yml`: v1's entry names
`auto-release.yml`, which [phase 1](./phase-0001-clean-slate-and-shell.md) deletes. That change, and the one-time
`v1` dist-tag, are manual steps in `docs/DEPLOY.md`.

**`ci.yml`.** The CLI job adds the TUI tests and a compile smoke for the host target.

### 9. User docs — `frontend/src/content/docs/{cli,tui}.md`, `getting-started.md`

- **`cli.md`** covers installing (script, npm or Bun, binary), signing in (device flow, `--with-password`),
  `--follow`, upgrading and channels, and a short "Coming from v1?" box that links the `v1` branch.
- **`tui.md`** is new. It is v1's [docs/tui.md](https://github.com/evantahler/botholomew/blob/v1/docs/tui.md),
  adapted: tabs, keys, queue and steer, approvals, slash and `@` popups, links.
- **`getting-started.md`** gains a terminal path.

### 10. Tests

**`backend/__tests__/actions/cli-login.test.ts`**

- Start, then poll, gives `authorization_pending`.
- A second poll inside the interval gives `slow_down`.
- Approving writes an audit row, and the next poll returns `Set-Cookie` and a refresh token **exactly once**.
  A third poll is `expired_token`.
- Deny gives `access_denied`. An expired code gives `expired_token`.
- An unknown `userCode` and an approved one return the same 404 to a different user.
- An unauthenticated approve gets 401.
- Refresh rotates the token, and replaying the previous token revokes the session.
- Revoke makes refresh fail and logs the live cookie out.
- None of the `cli-login:*` actions, nor `cli-session:refresh`, is an MCP tool.

**`backend/__tests__/cli/follow.test.ts`** — the CLI binary against a booted server:

- `thread follow` prints a new message within a second, while the server's request counter shows no
  polling GETs after hydration.
- With the WebSocket path refused, it falls back to polling and still delivers.
- A server restart mid-follow reconnects and hydrates again without duplicating lines, because the cursor
  holds.

**`backend/__tests__/cli/chat.test.ts`** — renders `<ChatApp>` with `ink-testing-library`, using the real
client against a booted server and phase 6's fake model server, which streams deltas:

- Typed text appears as streamed deltas before the final message replaces them.
- A second message sent while busy renders dimmed, then claimed.
- `Esc` creates a `steer` inbox row.
- A gated MCP call shows the inline prompt, and `y` runs the recorded call.
- `/` lists project skills, and `@` lists bots.
- A resize redraws without leaving stale lines.

**`backend/__tests__/cli/cli.test.ts`** (extended):

- `login --with-password` round-trips.
- A `CLI_MINIMUM_VERSION` above the binary's version refuses commands, with the upgrade hint.

**`cli/__tests__/`**

- `tui/markdown.test.ts`, `tui/links.test.ts`, and `tui/slash-completion.test.ts` are ported from v1. The
  436-character OAuth URL renders without a single embedded newline.
- `live/channel-registry.test.ts`: subscribe, unsubscribe, subscribe in one turn sends one frame.
- `launcher.test.ts`: under Node with no `bun` on `PATH`, it prints guidance and exits 1.
- `v1-notice.test.ts`: a temporary home containing `.botholomew/` gets the notice once, then never again.
- `package.test.ts`: the `botholomew` and `bothy` bins, `files`, `engines.bun`, and a prerelease version
  mapping to the `next` tag.
- `install-script.test.ts`: `install.sh` runs against a fake registry and a fake release server (`BOTHOLOMEW_REGISTRY_URL`, `BOTHOLOMEW_RELEASES_URL`), installs the right asset, and refuses a binary whose checksum does not match.

**`frontend/e2e/cli-login.spec.ts`**

- A signed-out visit to `/cli-login?code=…` signs in, then shows the request metadata.
- Approve flips the login.
- The session appears under Signed-in CLIs and can be revoked.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

End to end, with a project that has a connected model, a gated MCP server, and a skill:

1. `bun run --cwd cli botholomew login --url http://localhost:8080`. The browser opens on `/cli-login` with
   the code filled in and your hostname shown. Approve it, and the terminal prints "Signed in as …".
2. `botholomew chat`. Ask Botholomew something that needs a tool. Tokens stream, and a tool box appears and
   folds when the call finishes.
3. While it works, type and send a second message. It sits dimmed, then is answered after the first.
4. Start a long answer and press `Esc` with "shorter, please". The reply changes course.
5. Type `/`, and the project's skills appear. Type `@`, and the bots appear.
6. Ask for something that calls the gated MCP server. The inline approval prompt appears; press `y`.
7. `Ctrl+t` shows open tasks, and `Ctrl+p` shows approvals. Resize the window: nothing smears. Ask for a long
   OAuth URL and use `Ctrl+L` to copy it whole.
8. In a second terminal, run `botholomew thread follow <id>`. Messages appear as they are posted. Then run
   `botholomew thread send <id> "and one more thing" --wait`, which returns as soon as the reply lands.
9. `bun run --cwd cli build:binary` builds the binary. `./dist/botholomew-<host> chat` behaves the same.

Then the edge cases:

- Stop the API mid-conversation. The status bar shows `reconnecting`, and on restart the chat re-hydrates with
  no duplicated lines.
- Block WebSocket upgrades in a proxy. The status bar shows `polling`, and messages still arrive.
- Revoke the session under Account → Signed-in CLIs. The next command fails with "run `botholomew login`".
- Wait past the one-day session TTL (or delete the Redis key). The next command refreshes silently.
- Create `~/.botholomew/` and run any command twice. The v1 notice appears once.
- Run `install.sh` against a staging release with a corrupted asset. It refuses on the checksum.

## Definition of done

- [ ] `botholomew chat`, with Chat, Threads, Tasks, Approvals, and Help tabs ported from v1's components, including the long-URL fix
- [ ] The queue is server-side (`follow_up`); `Esc` steers; queued messages render until claimed
- [ ] One WebSocket live client for the TUI and every `--follow`: subscribe, then hydrate; cursor re-reads; backoff; polling fallback
- [ ] A device-code login with an audited, never-MCP approval; refresh tokens with rotation and reuse detection; revocable CLI sessions; `--with-password` kept
- [ ] A Bun-target npm bundle with a launcher that works under Node; `botholomew` and `bothy` bins
- [ ] Binaries for five targets, darwin ad-hoc signed, smoke-tested on three operating systems, with `SHA256SUMS`
- [ ] `install.sh` at www.botholomew.com resolves the version from the npm dist-tag and verifies checksums
- [ ] `botholomew upgrade` follows the installed channel; a server-advertised minimum CLI version
- [ ] `release-cli.yml`: binaries, then a draft release, then OIDC npm publish with provenance, then undraft; prereleases go to `next`; `"private": true` dropped in the same commit
- [ ] The `v1` dist-tag exists before the first 2.x publish; `latest` moves only at 2.0.0; the first-run v1 notice; v0.27.3's `upgrade` checked against staging
- [ ] `cli.md`, `tui.md`, and `getting-started.md`
- [ ] Tests cover single-use device codes, refresh reuse revocation, socket follow with no polling, the polling fallback, TUI rendering against a booted server, the launcher, and checksum refusal

## Commands

```bash
# One-time, before the first 2.x publish (also recorded in docs/DEPLOY.md).
npm dist-tag add botholomew@0.27.3 v1
npm dist-tag ls botholomew

# Install paths.
curl -fsSL https://www.botholomew.com/install.sh | sh               # latest
curl -fsSL https://www.botholomew.com/install.sh | sh -s -- --channel next
bun add -g botholomew@next                                          # npm channel; needs Bun
bun add -g botholomew@v1                                            # back to v1

# Local build and smoke.
bun run --cwd cli build && bun run --cwd cli build:binary
./cli/dist/botholomew-linux-x64 --version
```

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
