# Phase 1 — Clean slate and shell

> **Goal:** The repository stops being the v1 local agent and becomes a Bun workspace holding ToolExec's
> plumbing under Botholomew's name: a person can sign up, land in their own project, invite a teammate, tag
> them, read the audit log, connect Claude over MCP, and do all of it again from `botholomew` on the command
> line — with every suite green behind one required CI check.

> **Status: planned, not built.** Stage A — Platform. Depends on nothing but the planning PR that carries these
> docs; [phase 2](./phase-0002-deployment.md) deploys what this phase leaves behind.

v1 is a single-user CLI whose every module assumes a project directory on disk, a DuckDB file owned by
membot, and one process that is both the person's terminal and the agent. None of that survives contact with
a multi-tenant service: tasks are markdown files claimed with `O_EXCL` lockfiles, threads are CSVs, the worker
is a pidfile. What 2.0 keeps from v1 is ideas and a handful of pure functions — the prompt loader, the
line-patch format, the skill parser, the `src/llm/` boundary — and later phases port each one deliberately,
with its tests, from the [`v1` branch](https://github.com/evantahler/botholomew/tree/v1). Porting them in
place, with v1 still running around them, would mean keeping two architectures green at once for months. So
this phase is a clean break: the tree is emptied and the plumbing arrives in one change.

The plumbing is ToolExec's, because ToolExec has already paid for it. Users, projects as tenants, tag-based RBAC
with an introspection endpoint the UI cannot drift from, invites, `AuditedAction`, MCP OAuth for human
clients, a session CLI, real-server tests, a CI gate that asserts success rather than listing failures, and a
Render blueprint with tests of its own — each of those carries a learnings section explaining a bug it has
fixed. Copying is about 2–3k lines of *cutting*, not a pure copy: ToolExec is agents-in-sandboxes, and
sandbox, run, agent, workflow, proxy, and connection code reaches into files that are otherwise plumbing.

It deliberately ships nothing a bot does, and ends at a shell that is honest about being one.

## Scope

**In:** confirming the `v1` branch; `git rm` of every v1 path except the 2.0 plans and the instruction
file; copying ToolExec's shell — root workspace, backend entry and config, secrets initializer, MCP publish
policy, `AuditedAction`, session and RBAC middleware, the user / session / project / membership / tag / invite /
audit actions and ops, seven schema files with a fresh `0000` migration that already carries
`audit_logs.actorBotId` and `onBehalfOfUserId`, the frontend shell and its UI kit, the CLI's auth / project /
tag / member / invite / audit commands, `ci.yml` on `pgvector/pgvector:pg18`, and a trimmed `render.yaml`;
renaming and scrubbing everything ToolExec-specific; Keryx `^0.48`; a Keryx contract test; reconciling
[AGENTS.md](../../AGENTS.md) with the shell; a new root `README.md`; `docs/cloud-setup.md`; user docs for what
exists; branch protection on "CI Complete".

**Out:** syncing the blueprint, domains, Sentry, and the pgvector extension ([phase 2](./phase-0002-deployment.md));
organizations ([phase 3](./phase-0003-organizations.md)); anything a bot does (phases
[4](./phase-0004-project-memory-core.md)–[8](./phase-0008-context-management.md)); `project_connections`,
`project_settings`, and gateway OAuth, which return with the features that need them
([phase 5](./phase-0005-bots.md), [phase 10](./phase-0010-mcp-servers-and-approvals.md)); the notifications table,
bell, and channels ([phase 7](./phase-0007-threads-and-web-chat.md)); npm publishing and binaries
([phase 15](./phase-0015-tui-and-cli-publishing.md)); project dump/apply (later, unphased).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| The `v1` branch | v1 at v0.27.3, already pushed from `origin/main` by the planning PR's session; the permanent home of every file this phase deletes | [`v1`](https://github.com/evantahler/botholomew/tree/v1) |
| AGENTS.md | The repository's one instruction file (`CLAUDE.md` is a symlink to it), from the planning PR; its rules bind this phase and every later one | [AGENTS.md](../../AGENTS.md) |
| The 2.0 plans | This directory: the index and every phase doc, which survive the `git rm` | [README](./README.md#roadmap) |
| Tenancy and RBAC | `createProjectForOwner`, `RBAC_DESCRIPTOR` factories, `actions:permissions`, last-admin guards, `buildTestUniverse()` | `toolexec:backend/middleware/rbac.ts`, `toolexec:backend/ops/ProjectOps.ts`, `toolexec:docs/plans/phase-04-users-and-tenancy.md` |
| Audit | `AuditedAction` (mutation and audit row in one transaction), `SENSITIVE_KEYS` scrubbing, `audit:list`, `audit:sweep` | `toolexec:backend/classes/AuditedAction.ts`, `toolexec:backend/ops/AuditOps.ts` |
| MCP publish policy | Human MCP ≈ HTTP, a closed never-MCP list, asserted by `rbac.test.ts` | `toolexec:backend/ops/McpToolPolicyOps.ts` |
| Encryption key check | Boot fails on a missing or wrong-length `SECRETS_ENCRYPTION_KEY` | `toolexec:backend/initializers/secrets.ts`, `toolexec:backend/ops/CryptoOps.ts` |
| Frontend shell | Auth context, protected routes, settings sections framework, `can()`, docs renderer, the `src/ui` kit | `toolexec:frontend/src/` |
| Product CLI | A Commander session client with `--json`, `--url`, `--project`, and XDG config | `toolexec:cli/src/` |
| CI and its gate | Parallel jobs; `complete` asserts every `needs` result **is** `success` | `toolexec:.github/workflows/ci.yml` |
| Deployment config and its test | Five-resource blueprint; `render-blueprint.test.ts` parses it with Zod | `toolexec:render.yaml`, `toolexec:backend/__tests__/deployment/render-blueprint.test.ts` |
| Doc links test | Every relative link and anchor in `AGENTS.md`, `README.md`, `docs/**` resolves; every plan doc keeps its learnings heading | `toolexec:backend/__tests__/docs/links.test.ts` |

What does not exist: anything 2.0-specific in code. `audit_logs` has no notion of a bot, the MCP policy has
nothing to say about bots, and the job queues are named for runs.

## What this must not weaken

1. **v1 stays reachable.** `v1` is never rewritten, force-pushed, or deleted; everything removed from `main`
   is one URL away on it.
2. **The plans and the instruction file survive.** `AGENTS.md`, its `CLAUDE.md` symlink, `docs/plans/README.md`,
   and every `docs/plans/phase-*.md` are excluded from the `git rm` by name, and the step that empties the tree
   proves it.
3. **Only plumbing crosses.** No sandbox, run, agent, workflow, proxy, connection, GitHub App, or mcp-app code;
   no ToolExec or Arcade domain, package scope, service name, or Sentry DSN; no secret of any kind.
4. **Every copied guarantee keeps its test.** If a test is cut, the guarantee it proved is either cut too or
   re-proved by a rewritten test. The last-admin guards, audit atomicity, the never-MCP list, OAuth loopback
   redirect matching, and the native-addon guard all arrive with their suites.
5. **One required check.** "CI Complete" asserts that every job succeeded; adding a job never touches branch
   protection.
6. **Real services in every test.** A booted server over HTTP against Postgres (the pgvector image) and Redis.

## Design

### A clean break, not a migration

The alternative — grow `backend/` beside `src/` and delete v1 at the end — loses for three reasons. v1's
CI builds a compiled binary with DuckDB and onnxruntime embedded, and keeping that green while a Keryx
workspace grows next to it buys nothing. v1's `auto-release.yml` publishes a release on every version bump, so
a half-converted `package.json` would ship a broken binary to every v1 user's `botholomew upgrade`. And the
docs site would keep describing v1 at www.botholomew.com while the code underneath it stopped being v1.

With this phase, `main` publishes nothing: `auto-release.yml` and `docs-deploy.yml` are gone, so the last v1
release stays the latest one, and GitHub Pages keeps serving the last v1 docs build;
[phase 2](./phase-0002-deployment.md) is what points the domain at the app. Two things later phases inherit, recorded
here because this is where they are created: v1's self-updater checks both the npm `botholomew` package and
the latest GitHub release whose assets are named `botholomew-<os>-<arch>`
([src/update/updater.ts](https://github.com/evantahler/botholomew/blob/v1/src/update/updater.ts)), so
[phase 15](./phase-0015-tui-and-cli-publishing.md) must not publish 2.x under either without deciding what a v1
user's `botholomew upgrade` does; and the install URL in v1's README
(`…/main/install.sh`) stops resolving here — v1 users install from the `v1` branch's copy instead.

### Copy by manifest, then cut

Files are copied **by explicit list** from a ToolExec checkout at a recorded commit (`c55c332` is the ToolExec
commit this plan reads; use whatever is current and record the SHA). A directory is never copied
wholesale: wholesale is how a sandbox import slips in. Each copied file is then cut by one rule — **delete
the import of a dropped module, then delete the code that needed it; never stub it.** A stub is a promise
nobody tracks; a deletion is visible in review and in the type checker. Where a cut changes what a file's
JSDoc claims, the JSDoc is rewritten in the same edit, because AGENTS.md's rule against stale docs applies
from the first commit.

### Keryx `^0.48`, and the facts the design leans on

ToolExec pins `^0.45`; the shell moves to `^0.48` in `backend/` and in the frontend's dev dependency (which
exists for types). The bot loop in [phase 6](./phase-0006-durable-bot-loop.md) is shaped around six facts this plan
reads from Keryx: one-off `enqueue` gets no lock, dedupe, or retry; a failed or crashed job is not
retried; task connections carry no session; `enqueueIn` / `enqueueAt` default to the `"default"` queue; the
action timeout defaults to five minutes; PubSub is fire-and-forget and is forwarded to MCP sessions. **They are
re-verified against the version this phase actually installs**, by reading `node_modules/keryx`, and the
result — version, file, and line for each — goes in this doc's learnings. The two that the shell can exercise
get a contract test (step 15), so a later Keryx bump that changes them fails `bun test` instead of a lease.
Anything that turns out to be a Keryx bug goes upstream first (AGENTS.md rule 4).

### A fresh `0000`, with the bot columns already in it

ToolExec's thirty-three migrations describe tables this repository never has. The shell's schema is
seven files, so ToolExec's `backend/drizzle/` and its `meta/` are not copied and `bun run migrations`
generates one fresh `0000`. `audit_logs` gains `actorBotId` and `onBehalfOfUserId` now — nullable integers, no foreign key yet —
because every bot-made change in [phase 5](./phase-0005-bots.md) and every phase after it (creating a
worker, editing a prompt or a skill) is audited through them, and adding audit columns later would mean a
migration on the one table that is deliberately never rewritten. They carry no foreign key for the reason `projectId` has none: the record must
outlive its subject. A bot table to point at does not exist yet anyway.

### Renaming and scrubbing

| From | To |
|---|---|
| `toolexec`, `ToolExec`, `TOOLEXEC_*` | `botholomew`, `Botholomew`, `BOTHOLOMEW_*` |
| `Symbol.for("toolexec.rbac")` | `Symbol.for("botholomew.rbac")` |
| `toolexec.activeProjectId` (localStorage) | `botholomew.activeProjectId` |
| `toolexec-workspace` / `-backend` / `-frontend`, `@arcadeai/toolexec` | `botholomew-workspace` / `-backend` / `-frontend`, `botholomew` |
| `--tx-*` CSS properties, `tx-*` classes | `--bh-*`, `bh-*` |
| `theme/toolexec-theme.ts`, `templates/lion.svg` | `theme/botholomew-theme.ts`, `templates/owl.svg` (the v1 site's `{o,o}` owl) |
| `~/.config/toolexec`, `https://api.toolexec.ai` | `~/.config/botholomew`, `https://api.botholomew.com` |
| `toolexec_test`, `toolexec` databases | `botholomew_test`, `botholomew` |

Removed outright: every `toolexec.ai`, `arcadeai`, `arcadeai-labs`, `ngrok.app`, and `sentry.io` string;
`ngrok.yml`, `backend/scripts/start-ngrok.ts`, `frontend/devTunnel.ts` (reserved tunnel names belong to
ToolExec's account); the committed Sentry DSN; the GitHub App keys; `.cursor/`. The development
`SECRETS_ENCRYPTION_KEY` in `.env.example` is **newly generated** (`openssl rand -base64 32`), not copied, even
though ToolExec's is a test-only value: nothing crosses that was ever someone else's key. The one Arcade URL
that stays is AGENTS.md's link to Patterns for Agentic Tools, which is a citation, not a service.

## Steps

### 1. Confirm the `v1` branch — `refs/heads/v1`

The `v1` branch is the planning PR session's `git push origin origin/main:refs/heads/v1`: `origin/v1` points at
`d9dabb0`, the same commit as `origin/main` at that push. Before deleting anything, confirm it is still there
and still an ancestor of `main`, and protect it from deletion and force-push:

```bash
git fetch origin && git merge-base --is-ancestor origin/v1 origin/main && echo "v1 is intact"
gh api -X PUT repos/evantahler/botholomew/branches/v1/protection \
  -F required_status_checks=null -F enforce_admins=true \
  -F required_pull_request_reviews=null -F restrictions=null \
  -F allow_force_pushes=false -F allow_deletions=false
```

### 2. Empty the tree — `git rm`

```bash
git rm -r -q src test scripts .conductor .vscode .github/workflows \
  install.sh bunfig.toml tsconfig.json biome.json bun.lock package.json .gitignore README.md
git rm -r -q docs/.vitepress docs/assets docs/public docs/tapes
git rm -q docs/*.md docs/plans/milestone-*.md docs/plans/disk-backed-project-layout.md \
  docs/plans/v1-milestones.md
# The only survivors. This must print nothing:
git ls-files | grep -vE '^(AGENTS\.md|CLAUDE\.md|docs/plans/(README|phase-[0-9]{2}-[a-z0-9-]+)\.md)$'
```

That removes v1's 193 source and 72 test files, `scripts/{build,capture}.ts`, the nineteen `docs/*.md` pages,
the VitePress config and theme, the GIFs and VHS tapes, `docs/public/CNAME`, the seventeen milestone docs,
`disk-backed-project-layout.md`, `v1-milestones.md`, the four workflows (`auto-release`, `bump-mcpx`, `ci`,
`docs-deploy`), and the Conductor and VS Code settings that only make sense for v1. `AGENTS.md` and
`CLAUDE.md` are not in the list and are never touched as files here; step 13 edits `AGENTS.md`'s content.

### 3. Repo root — `package.json`, `biome.json`, `.gitignore`, `.dockerignore`

Copied from ToolExec. `package.json` is `botholomew-workspace`, `private`, version `2.0.0-alpha.0`, workspaces
`backend`, `frontend`, `cli`, scripts as ToolExec's minus `ngrok`. `trustedDependencies` stays `["esbuild"]`
(it **replaces** Bun's default list; see the native-addon test). `bun.lock` is generated fresh by
`bun install` — ToolExec's lockfile resolves packages this repository does not have.

### 4. Backend entry, tooling, and config — `backend/{index,keryx,migrations}.ts`, `backend/config/`

Copy `index.ts`, `keryx.ts`, `migrations.ts`, `tsconfig.json` (drop `mcpApp` from `exclude`), `bunfig.toml`,
`biome.json`, `Dockerfile`, `.env.example`. `package.json` becomes `botholomew-backend`, version
`2.0.0-alpha.0`, Keryx `^0.48`, and drops `@keryxjs/mcp-app`, `@openrouter/sdk`, `@vercel/sandbox`, `ssh2`,
`cron-parser`, `nodemailer`, `remark-*`, `rehype-*`, `unified`, `unist-util-visit`, `@types/nodemailer`,
`@types/ssh2`, `jsdom`, the `sandbox:*` scripts, and `tsc -p mcpApp` from `lint` / `format`. It keeps
`@keryxjs/sentry` (dark until a DSN exists) and `@modelcontextprotocol/sdk` (the MCP tests' client).

| File | Cut |
|---|---|
| `config/index.ts` | The `notifications`, `proxy`, `runs`, and `sandbox` imports and keys; those four files are not copied |
| `config/tasks.ts` | `queues: ["bots", "orchestrator", "default"]`. The comment's argument is rewritten: `bots` holds conversation ticks a person may be waiting on, `orchestrator` the cheap reconciling clocks, `default` the sweeps. [Phase 2](./phase-0002-deployment.md) inserts `embed` and argues the order |
| `config/{audit,secrets,sentry,plugins}.ts` | JSDoc only: no `project_secrets`, no ToolExec env group name |
| `.env.example` | The sandbox, exe.dev, proxy, SMTP, webhook, supervisor, GitHub App, and ngrok blocks; database names; `PROCESS_NAME=botholomew-api`; `WEB_SERVER_THEME`; the fresh dev key |

### 5. Initializers, middleware, and the audited base — `backend/{initializers,middleware,classes}/`

| File | Treatment |
|---|---|
| `initializers/secrets.ts` | Copied |
| `initializers/mcpToolPolicy.ts` | **New name**, cut from the 463-line `mcpAgentTools.ts` to its `initialize()` — `applyMcpToolPolicy(api.actions.actions)` — and its JSDoc, about 80 lines. Gone: per-agent tool registration (`McpAgentToolsOps`), the run-token `beforeAct` split (`isSandboxOnly*`, `isRunTokenClientId`), `syncSessionTools`, `refuseSandboxMcpGetStream` |
| `initializers/{githubApp,modelPrices,redisScripts}.ts` | Not copied |
| `middleware/session.ts`, `middleware/rbac.ts` | Copied; the symbol renamed. `runToken.ts` and `runTokenRateLimit.ts` are not copied |
| `classes/AuditedAction.ts` | Copied unchanged |

### 6. Ops — `backend/ops/*.ts`

`AuditOps`, `CryptoOps`, `InviteOps`, `MembershipOps`, `ProjectOps`, `TagOps`, `UserOps`, `McpToolPolicyOps`.
The other forty-odd ops files, `ops/modelClients/`, and `ops/templates/` stay behind.

| File | Cut |
|---|---|
| `McpToolPolicyOps.ts` | `SANDBOX_ONLY_ACTION_NAMES`, `SANDBOX_ONLY_TOOL_NAMES`, `isSandboxOnly*`. `NEVER_MCP_ACTION_NAMES` shrinks to `user:create`, `session:create`, `session:destroy`, `status`, `swagger`, `actions:permissions`. The `proxy:` and `connection:github-install-` prefix rules go; the `webhook:` and `gateway:oauth-` prefix rules **stay** — AGENTS.md rule 6 names both, the actions they guard return with [phase 14](./phase-0014-schedules-and-wakeups.md) and [phase 10](./phase-0010-mcp-servers-and-approvals.md), and a rule that is already there cannot be forgotten |
| `AuditOps.ts` | `runToken` leaves `SENSITIVE_KEYS`; `AuditLogEntry` and `serializeAuditLog` gain `actorBotId` and `onBehalfOfUserId` |
| `CryptoOps.ts` | JSDoc only. It encrypts nothing yet; it exists so the boot check is real from the first deploy |

### 7. Schema and the fresh migration — `backend/schema/*.ts`, `backend/drizzle/0000_*.sql`

`users`, `projects`, `project_memberships`, `project_invites`, `tags`, `user_tags`, `audit_logs`, copied with
their JSDoc (the `withTimezone` and no-foreign-key arguments are worth keeping verbatim). One change:

| Column | Type | Notes |
|---|---|---|
| `audit_logs.actorBotId` | `integer`, nullable, no FK | Set when a bot made the change. Always null while no bot exists |
| `audit_logs.onBehalfOfUserId` | `integer`, nullable, no FK | The person whose message caused a bot's change, when there was one |

With no `backend/drizzle/` copied, `bun run migrations` generates `0000`. Review it as a whole file: it is the
baseline every staging database starts from.

### 8. Actions — `backend/actions/**`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `status`, `swagger`, `actions:permissions` | `GET /status`, `/swagger`, `/actions/permissions` | none | — | never |
| `user:create` / `session:create` / `session:destroy` | `PUT /user`, `PUT` / `DELETE /session` | rate limit (+ session) | `user:create` yes | never |
| `user:edit`, `me:view` | `POST /user`, `GET /me` | session | `user:edit` yes | yes |
| `project:create` / `:view` / `:list` / `:edit` / `:delete` | `PUT` / `GET /project`, `GET /projects`, `POST` / `DELETE /project` | session / member / session / admin / admin | mutations | yes |
| `membership:*`, `tag:*`, `user-tag:*`, `invite:*`, `audit:list` | as ToolExec | as ToolExec | mutations | yes |
| `invites:sweep`, `audit:sweep` | task-only, queue `default`, daily | — | no (sweeps) | never |

`project-delete.ts` is the one action that needs real surgery: drop the type-only `config/sandbox` import, the
four `SandboxOps` imports, `lockProjectSandboxWrites`, the provisioning refusal, the destroy loop, and
`strandedSandboxIds`; return `{ success: true }`. What remains is the one-statement cascade its own JSDoc
describes in its first paragraph — rewrite the rest of that JSDoc. `project:view` keeps its `mcp` block (the
address a person's Claude connects to). `status` changes its migration probe from
`SELECT agent_id FROM workflow_run_steps` to `SELECT actor_bot_id FROM audit_logs LIMIT 0`, the newest column
in `0000`. `project-{apply,dump,overview,settings-*}.ts` and `components-catalog.ts` are not copied.

### 9. Templates, theme, scripts — `backend/{templates,theme,scripts}/`

`templates/oauth-authorize.html` and `oauth-common.css` (the `{{> lionSvg}}` partial becomes `owlSvg`),
`theme/botholomew-theme.ts` with its JetBrains Mono fonts, and `scripts/{setup-workspace,workspace,repair-sequences}.ts`
(`TOOLEXEC_WORKSPACE_ID` becomes `BOTHOLOMEW_WORKSPACE_ID`). `channels/`, `agents/`, `connections/`, `sandbox/`,
`mcpApp/`, `lua/`, and `assets/` are not copied.

### 10. Frontend — `frontend/`

Copy Vite, React, Router, Tailwind, and SCSS setup; `src/ui`, `styles/` (`studio.css` trimmed to its utilities
layer), `theme/`, `utils/{client,permissions,skeleton}.ts`, `hooks/useFirstLoad.ts`,
`context/{AuthContext,LiveSocketContext}.tsx`, `ProtectedRoute`, `Layout`, `MarkdownBlock`, `LoadingLabel`,
`SkeletonBlocks`, `SkeletonRows`, `components/sections/*`, and `components/settings/{context.ts,sections.ts,SettingsSectionNav.tsx}`.
Pages: SignIn, SignUp, Account, Invites, NewProject, Home (a project placeholder that says what is in development),
Settings, AuditLog, Status, StyleGuide (minus its `RunArtifact` / `RunUsage` / `WorkflowRunUsage` specimens),
`pages/docs/*`, and a rewritten `pages/marketing/HomePage.tsx`.

| File | Cut |
|---|---|
| `components/Layout.tsx` | `NotificationBell` and its slot; the Agents, Workflows, Runs, and Help links. The brand reads "Botholomew" |
| `App.tsx` | Every agent, workflow, run, help, OAuth-return, and GitHub-install route and import; `NotificationProvider` and `NotificationToasts`. Settings keeps `general`, `members`, `tags`, `mcp`, `danger` |
| `components/settings/context.ts`, `pages/SettingsPage.tsx` | The `connection:list` types, catalog, and fetch |
| `pages/marketing/HomePage.tsx` | `SoftwareFactoryDag` and its copy, replaced by what Botholomew 2.0 is, labeled as in development, with a link to v1 |
| `vite.config.ts`, `package.json` | `viteDevServerTunnel`; `@xyflow/react`; `docs:illustrations`; Keryx dev dependency `^0.48` |

Not copied: `public/docs/illustrations/` and `scripts/capture-doc-illustrations.mjs` (screenshots of ToolExec),
`NotificationContext`, and every agent, run, workflow, mission-control, and connection component.

### 11. CLI — `cli/`

Copy `client`, `config`, `context`, `helpers`, `output`, `palette`, `banner`, `program`, `index`, `resolve`,
`interpolate` (kept for the secret-taking commands later phases add: `$VAR` resolution from the environment).
`follow.ts` is not copied. `package.json`: name `botholomew`, version `2.0.0-alpha.0`, bins `botholomew` and
`bothy` → `dist/botholomew.js`, and **`"private": true`**, which [phase 15](./phase-0015-tui-and-cli-publishing.md)
lifts when it publishes — so nothing can push 2.0 onto v1 users' npm `latest` by accident.

| Command | Wraps |
|---|---|
| `botholomew login` / `logout` / `whoami` | `session:create`, `session:destroy`, `me:view` |
| `botholomew project list \| create \| view \| edit \| delete \| use` | `project:*` (`overview`, `settings`, `dump`, `apply` cut) |
| `botholomew tag list \| create \| edit \| delete \| assign \| unassign` | `tag:*`, `user-tag:*` |
| `botholomew member list \| add \| remove` | `membership:*` |
| `botholomew invite list \| pending \| create \| accept \| reject` | `invite:*` |
| `botholomew audit list` | `audit:list`, moved out of `inbox.ts` into `commands/audit.ts` |

`--url`, `--project`, `--json`, `--no-color` stay global; `BOTHOLOMEW_URL` and `BOTHOLOMEW_PROJECT` replace
the ToolExec variables.

### 12. CI and deploy config — `.github/workflows/ci.yml`, `render.yaml`

`ci.yml` keeps backend lint / test / docker, CLI lint (with its unit tests), frontend lint / build / test /
docker, e2e, and `complete` (job id `complete`, name "CI Complete", the `toJSON(needs)` success assertion
verbatim). Both service-container Postgres images become **`pgvector/pgvector:pg18`** with database
`botholomew_test`, so the extension exists in CI before any migration needs it. Gone: `sandbox-image`,
`kubernetes-test`, the PR-base fetch, the leftover-container check, `publish-cli.yml`, and
`publish-sandbox-image.yml`. v1's gate reports as `complete`; repoint branch protection to the new name in
the window between opening this PR and merging it:

```bash
gh api -X PUT repos/evantahler/botholomew/branches/main/protection \
  -F required_status_checks[strict]=true -F 'required_status_checks[contexts][]=CI Complete' \
  -F enforce_admins=false -F required_pull_request_reviews[required_approving_review_count]=0 -F restrictions=
```

`render.yaml` is trimmed to `botholomew-api`, `botholomew-worker`, `botholomew-frontend`, `botholomew-redis`,
`botholomew-db`, and the `botholomew-shared` group (`NODE_ENV`, `LOG_*`, `SECRETS_ENCRYPTION_KEY`,
`FRONTEND_URL`). It names the `*.botholomew.com` origins but is **not synced** — that is
[phase 2](./phase-0002-deployment.md). No Sentry, GitHub App, SMTP, sandbox, or body-cap keys.

### 13. Repo docs — [AGENTS.md](../../AGENTS.md), `README.md`, `docs/cloud-setup.md`

AGENTS.md already states the rules; this phase makes its **Local development**, **Commands**, and **Where the
detail lives** sections true of a tree that now exists. Every command in those blocks is run against the
shell and corrected where the real script, port, or database name differs; lines that name tasks a later phase
adds stay, under the status note that already says so. The status note's sentence about v1 occupying the tree
is replaced. Any mention of ToolExec moves into [the plans index](./README.md), which is where credit for the
template belongs and the one place the scrub gate exempts.

`README.md` is new and short: what Botholomew 2.0 is, that it is in development, local prerequisites (Bun,
Postgres with pgvector, Redis — no Docker Compose), first-run commands, and links to the `v1` branch and to
`docs/plans/`. `docs/cloud-setup.md` records what a cloud agent VM needs: Postgres and Redis as system
services, the `postgresql-<major>-pgvector` package, `createdb botholomew && createdb botholomew_test`, the two
`.env` copies, and the `pg_hba.conf` trust setting — modeled on `toolexec:docs/cloud-setup.md`.

### 14. User docs — `frontend/src/content/docs/*.md`

`overview`, `getting-started`, `teams`, `cli`, `mcp`, and `security`, registered in `sections.ts`, each
rewritten to describe only what exists: signing up, projects, members, tags and the `admin` tag, invites, the
audit log, the CLI's commands, and connecting an MCP client. `security.md` states the boundary the shell
already enforces — membership grants read, `admin` grants administration, audit rows outlive their subjects.

### 15. Tests — `backend/__tests__/`, `frontend/src/__tests__/`, `frontend/e2e/`, `cli/__tests__/`

**Copied as-is** (names scrubbed): `actions/{status,user,session,membership,tag,invite,audit}.test.ts`,
`oauth/{authorize-theme,redirect-loopback}.test.ts`, `deps/native-addons.test.ts`, `docs/links.test.ts`,
`ops/crypto.test.ts`, `config/sentry.test.ts`, `scripts/workspace.test.ts`.

**Rewritten to shell scope:**
- `__tests__/setup.ts` — keeps `buildTestUniverse`, `createUserAndLogin`, `createTag`, `inviteAndAccept`,
  `getMcpAccessToken`, `runAction`, `drainTasks`, `retryClearDatabase`; drops the GitHub App helpers,
  `createAgent`, the docker cleanup, `dropFaultInjection`, and `clearRunKeyedRedis`.
- `actions/rbac.test.ts` — `actions:permissions` mirrors enforcement; every action's `mcp.tool` equals
  `shouldPublishAsMcpTool`; every action taking `projectId` declares `member` or `admin`; **every name on the
  never-MCP list is a registered action** (a typo would otherwise pass silently); the five RBAC permutations.
- `actions/mcp-tools.test.ts` — a human OAuth session's `tools/list` is exactly the published shell set; no
  never-MCP name appears; an unauthenticated request reaches no tool; an outsider's client is refused another
  project's `membership-list`.
- `actions/project.test.ts` — create, list with pagination, edit, delete cascades to memberships, tags, and
  invites while the audit row survives; `project:view` reports the MCP address.
- `deployment/render-blueprint.test.ts` — topology, one migrator, one task runner, build filters, origins,
  one `SECRETS_ENCRYPTION_KEY` in the group, Dockerfile agreement, no secret literal, the `COMPUTE_PLANS` enum.
- `schema/indexes.test.ts` — the shell's indexes, read from `pg_indexes`.

**New:**
- `docs/tense.test.ts` — the mechanical slice of AGENTS.md's present-tense rule, the sibling of
  `links.test.ts`. It scans `AGENTS.md`, `README.md`, `docs/**`, and every comment under `backend/`,
  `frontend/src/`, and `cli/src/` (`//` and `/* … */` in `.ts` / `.tsx`), ignores fenced code and inline code
  spans, and fails on a closed denylist: `will`, `won't`, `going to`, `used to`, `previously`, `formerly`,
  `originally`, `no longer`, `in the future`, `eventually`, `for now`, `TODO`, `FIXME`. A hit names the file,
  the line, and the word. There is no allowlist: a sentence that trips it is rewritten.
- `cli/cli.test.ts` — spawns the real CLI against the booted server: `login`, `project list`, `tag create`,
  `invite create` → `accept`, `audit list --json`.
- **New:** `deps/keryx-contract.test.ts` — enqueuing `invites:sweep` twice as a one-off yields two jobs (no
  dedupe), and `enqueueIn` without a queue lands on `default`.
- **New:** an assertion in `audit.test.ts` that a human action's row has `actorBotId` and `onBehalfOfUserId`
  null.

Frontend unit tests kept: `client`, `docs-sections`, `layout`, `live-socket`, `settings-sections`, `skeleton`,
`theme-tokens`, `ui-variants`, `label-casing`, `mobile-layer`, `modern-layer-scope`. E2E keeps `global-setup.ts`,
`env.ts`, `route.ts`, and the `auth`, `audit`, `docs`, and `smoke` specs (minus the DAG and "Why ToolExec"
cases), with `settings.spec.ts` rewritten to the five sections: all listed, one mounted at a time, renaming the
project moves the navbar switcher, and the dirty-guard cases. CLI unit tests keep `client`, `config`, `help`,
and `package` — the last now asserting the name, both bins, and `private: true`.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Before that, once per machine: system Postgres and Redis running, both databases created, `bun install`, both
`.env.example` files copied. After it:

```bash
cd frontend && bun run test:e2e && cd ..
git grep -ilE 'toolexec|arcadeai|ngrok\.app|sentry\.io' -- ':!docs/plans'   # must print nothing
git grep -il 'arcade\.dev' -- ':!docs/plans'                                 # AGENTS.md only: the PATs citation
docker build -f backend/Dockerfile . && docker build -f frontend/Dockerfile --build-arg VITE_API_URL=https://api.botholomew.com .
```

Manually, in the browser at `localhost:3000`:

1. The marketing page loads, says Botholomew 2.0 is in development, and links the `v1` branch; `/docs` reads
   signed out.
2. Sign up as Peach — land in "Peach's Project" as its admin. Create a tag `operators`.
3. Invite Mario with `operators`. In a second browser, sign up as Mario, see the invite, accept it; Mario
   appears in Peach's members list holding the tag.
4. Peach's audit log shows `project:create` (bootstrapped by `user:create`), `tag:create`, `invite:create`,
   and `invite:accept`, each with a before/after.
5. In a terminal, `botholomew login` as Mario, `botholomew project list`, `botholomew member list --json`.
6. Add `http://localhost:8080/mcp` to Claude as a connector, sign in as Peach, and ask it to list the project's
   members.

Then the edge cases:

- Mario cannot open Settings → Danger, and `botholomew project delete` as Mario is refused with 403.
- Removing Peach's own `admin` tag is refused: she is the last admin.
- `bun test` passes twice in a row in `backend/`.
- Break one assertion and confirm "CI Complete" goes red on the PR; restore it and confirm green.
- Booting with `SECRETS_ENCRYPTION_KEY` unset fails at boot, naming the variable.

## Definition of done

- [ ] `origin/v1` is an ancestor of `main` and protected against deletion and force-push
- [ ] The only files that survive the `git rm` are `AGENTS.md`, `CLAUDE.md`, and `docs/plans/{README,phase-*}.md`
- [ ] Root workspace (`backend`, `frontend`, `cli`) at `2.0.0-alpha.0` with a fresh `bun.lock`; Keryx `^0.48`
- [ ] The six Keryx facts re-verified against the installed version and recorded below; the contract test passes
- [ ] Shell backend copied by manifest and cut by deletion; `mcpToolPolicy.ts` replaces `mcpAgentTools.ts`
- [ ] Seven schema files and one fresh `0000` migration; `audit_logs.actorBotId` / `onBehalfOfUserId` present and null for every human action
- [ ] `project:delete` is the one-statement cascade; `status` probes `audit_logs.actor_bot_id`
- [ ] Frontend shell with five settings sections, docs, style guide, and a marketing page that claims nothing unbuilt
- [ ] CLI `botholomew` / `bothy` with auth, project, tag, member, invite, and audit commands; `private: true`
- [ ] `ci.yml` on `pgvector/pgvector:pg18`; branch protection requires exactly "CI Complete"
- [ ] `render.yaml` trimmed and its test green; not synced
- [ ] The scrub greps print nothing; no secret, DSN, domain, or tunnel name crossed
- [ ] AGENTS.md's Local development, Commands, and Where the detail lives are true; `README.md` and `docs/cloud-setup.md` written
- [ ] User docs for overview, getting started, teams, CLI, MCP, and security
- [ ] `links.test.ts` passes over `AGENTS.md`, `README.md`, and `docs/**`
- [ ] `tense.test.ts` passes over the same docs and every comment in `backend/`, `frontend/src/`, and `cli/src/`

## Commands

```bash
bun run --cwd cli botholomew --help
bun run --cwd cli botholomew invite create --email mario@example.com --tag operators --project 1
curl -s localhost:8080/api/actions/permissions | jq '.permissions["project:delete"]'   # {"type":"admin"}
cd backend && bun keryx.ts invites:sweep                                                # a task, by hand
psql botholomew -c "select action, actor_bot_id, on_behalf_of_user_id from audit_logs order by id desc limit 5;"
```

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
