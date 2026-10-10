# Phase 3 — Organizations

> **Goal:** Every project belongs to an organization. Signing up creates your personal organization with your
> first project in it; an organization's owners create projects in it, rename it, and delete it once it is
> empty; the navbar switches between organizations as easily as between projects — and none of it changes who
> can read or do anything inside a project.

> **Status: planned, not built.** Stage A — Platform. Depends on [phase 1](./phase-01-clean-slate-and-shell.md)
> and [phase 2](./phase-02-deployment.md): staging already holds projects, so the new column arrives with a
> backfill rather than an empty table.

Organizations are the thinnest layer this plan adds, and they are added now precisely because they are thin.
Today the schema has one tenant tier and nothing hangs off a project yet; after
[phase 4](./phase-04-project-memory-core.md) every memory file, bot, thread, and MCP server does. Putting a
grouping above projects costs one foreign key on `projects` before that, and a much harder conversation
after it. Later work wants the grouping — billing attaches to an organization, not to each project, and a team
running several projects wants one place that lists them — but none of that later work should get to decide
what an organization *is*, so this phase decides it first.

What it is: a named group of projects, with **owners** who may file new projects under it, rename it, and
delete it when it is empty, and **members** who are simply the people in its projects. What it is not: a
permission scope. The [decisions table](./README.md#core-architecture) is explicit that the project is the
privacy boundary and every permission is a project permission, and the design below is mostly an argument for
keeping that true while adding a layer above it.

Billing, organization-wide roles, inviting someone to an organization rather than a project, moving a project
between organizations, and SSO or verified domains are all deliberately absent.

## Scope

**In:** `organizations` and `organization_memberships` (with an `owner` flag); `projects.organizationId`
required, backfilled on staging; signup creating a personal organization and a first project inside it, by
extending `createProjectForOwner`; `organization:*` and `organization-member:*` actions; organization owners
creating projects, renaming, and deleting an empty organization; invites staying project-level, with accepting
one implying organization membership; organization membership maintained by every action that adds or removes
a project membership; the never-evaluated-at-org-level invariant and its tests; `audit_logs.organizationId` and
an owner-only organization activity log; the organization switcher, settings pages, and new-organization page;
`botholomew org`; MCP exposure; user docs; `buildTestUniverse()` extended with an owner who belongs to no
project.

**Out:** billing, plans, and anything a payment provider needs (later, unphased — no placeholder columns
either); organization-level roles beyond `owner`; organization-wide invites, domain capture, and SSO;
moving a project to another organization; leaving an organization as a self-service action; what deleting a
user or an organization with data means operationally ([phase 18](./phase-18-operations.md)).

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| `createProjectForOwner(tx, userId, name)` | The atomic project bootstrap — project, membership, reserved `admin` tag, user-tag — shared by signup and `project:create` | `backend/ops/ProjectOps.ts` (from `toolexec:backend/ops/ProjectOps.ts`) |
| Signup bootstrap | `user:create` runs the bootstrap in its transaction and writes an explicit `project:create` audit row for it | `toolexec:backend/actions/user.ts` |
| Invite acceptance | Ownership by email match; idempotent membership and tag grants in one transaction | `toolexec:backend/actions/invite/invite-accept.ts` |
| Last-admin guard | `getAdminUserIds` called inside the deleting transaction so two removals cannot both succeed | `toolexec:backend/ops/MembershipOps.ts`, `toolexec:backend/actions/membership/membership-delete.ts` |
| RBAC factories and introspection | `RBAC_DESCRIPTOR` on the object that enforces; `actions:permissions`; the frontend's `can()` | `toolexec:backend/middleware/rbac.ts`, `toolexec:docs/plans/phase-04-users-and-tenancy.md` |
| `AuditedAction` and `auditProjectId` | One transaction for the change and its row; scoping a row to an id that did not exist before the insert | `toolexec:backend/classes/AuditedAction.ts`, `toolexec:backend/actions/project/project-create.ts` |
| A data migration in the schema history | Hand-written DML beside DDL in a drizzle migration, and a test that reads the migration | `toolexec:backend/drizzle/0015_git_providers_only.sql`, `toolexec:backend/__tests__/actions/workflow-migration.test.ts` |
| The navbar project switcher and `activeProjectId` | The pattern the organization switcher repeats, including self-healing a stale selection | `toolexec:frontend/src/components/Layout.tsx`, `toolexec:frontend/src/context/AuthContext.tsx` |
| `buildTestUniverse()` | Peach, Mario, Luigi, Toad, and the outsider Bowser, joined through real invites | `backend/__tests__/setup.ts` from [phase 1](./phase-01-clean-slate-and-shell.md) |

What does not exist: anything above a project. A project's creator is recorded only in its first audit row.

## What this must not weaken

1. **The project is the privacy boundary.** Nothing inside a project — its members, tags, invites, audit log,
   and later its bots, threads, memory, and MCP servers — is readable or changeable because of organization
   membership or ownership.
2. **Every project permission is a project check.** `ProjectMemberMiddleware()` and `AdminMiddleware()` read
   project memberships and tags and nothing else.
3. **Nothing is left unmanageable.** A project always has an admin, as before; an organization always has an
   owner, by the same guard.
4. **Signup is one transaction.** A user never exists without their organization, project, membership, and
   `admin` tag.
5. **Every human decision is audited, and the record outlives its subject.**
6. **Invites stay the way into a project.** Nobody joins a project by joining an organization.

## Design

### The invariant: no permission is evaluated at the organization level

Stated precisely: **no decision about anything inside a project reads `organization_memberships`.** The two
organization middlewares guard exactly two kinds of thing — the organization row itself (view, rename, delete,
its owner list, its activity log) and the act of filing a new project under it. Owning an organization grants
no read on any project in it, no admin, and no way to act on a project's contents.

Four reasons, in order of weight:

- **The boundary has to be one list.** Botholomew's privacy model is deliberately blunt: there are no private
  threads, and anything said to a bot may surface to anyone who can read that bot. That honesty only holds if
  "who can read" is a single, visible list per project. An organization grant would make every project's real
  audience "its members, plus whoever owns the organization today" — a set that changes without the project's
  admins doing anything, and that no project screen shows.
- **One place to reason.** "Who can see this thread?" is answered by reading `project_memberships`,
  `user_tags`, and (from [phase 5](./phase-05-bots.md)) the bot's tag lists. A second source makes every
  permission a union, and every future check must remember both halves — the kind of rule a later phase
  forgets once.
- **Bots inherit project semantics.** Bots act with project permissions and carry per-bot tag lists. An
  organization layer would need its own answer for what a bot may do across projects; there is no good one,
  and not having the layer means not needing one.
- **Paying is not reading.** Billing will attach to organizations. Whoever holds the card should not, by that
  fact, read every conversation in every project the card pays for.

The cost is real and accepted: an owner cannot see into, or rescue, a project they are not in. Two things keep
that from becoming a trap. The last-admin guards mean no project is ever without an administrator to ask. And
deleting an organization requires it to be empty, enforced by the database, so an owner can never destroy a
project they cannot administer.

What an owner *does* see of projects they are not in is a **directory entry**: id, name, and creation time, so
they can understand why a delete is refused and whom to ask. That is the one piece of project metadata visible
beyond the project's members, it carries no content, and it confers no action.

### Organization membership is maintained, not granted

A row in `organization_memberships` exists for every owner and for every person with a membership in at least
one of the organization's projects — nothing else creates one. It is what the switcher lists and what the owner
list shows; it is never consulted for a project permission. Because it is derived, every writer of project
memberships keeps it in step, in the same transaction:

| Writer | Effect on organization membership |
|---|---|
| `user:create`, `organization:create` | Insert the caller as owner |
| `createProjectForOwner` (signup, `project:create`) | Ensure the creator's row (an owner already has one) |
| `invite:accept`, `membership:create` | Ensure the member's row, `owner = false`, idempotently |
| `membership:delete` | Prune the removed user's row if it is not an owner row and no membership remains in another project of the same organization |
| `project:delete` | Prune, as above, for every member of the deleted project |

Pruning takes `SELECT … FOR UPDATE` on the user's organization row **before** counting their remaining
memberships. Without it, two concurrent removals from two projects in the same organization each see the other
membership still present, neither prunes, and both commit — a member of nothing who still sees the organization.
This is the last-admin guard's lesson applied to a count.

### Owners

`owner` is a flag on an existing organization membership. Owners set and clear it for each other through
`organization-member:edit`, which refuses to clear the last one, counting owners under `FOR UPDATE` inside the
transaction. Because an owner's row is never pruned, an owner may belong to no project in their own
organization — the case the boundary tests are built around. Making someone an owner who is not yet a member
means inviting them to a project first: invites stay the only door in.

### Signup and the bootstrap

`createOrganizationForOwner(tx, userId, name)` inserts the organization and the owner row.
`createProjectForOwner(tx, userId, organizationId, name)` gains the organization argument and ensures the
creator's organization row. Signup calls both, in that order, in its one transaction: "Peach's Organization"
holding "Peach's Project". It writes two explicit audit rows, as ToolExec's signup already does for its
bootstrap project — `organization:create` (organization-scoped) and `project:create` (both ids) — so neither
log opens without a record of its own creation. [Phase 5](./phase-05-bots.md) extends the same project bootstrap
to seed the leader bot, which is why it stays the single seam.

### Creating, renaming, deleting

Any signed-in user may create an organization and becomes its owner — the analogue of ToolExec letting any
signed-in user create a project. `project:create` now **requires** `organizationId` and passes only for an owner
of that organization; a non-owner who wants a project creates it in their own personal organization.

`organization:delete` is refused while any project remains, with a typed error naming how many and, for the
owner's benefit, their directory entries. The rule is enforced twice: by the action, for the message, and by
`projects.organization_id … ON DELETE RESTRICT`, for the race — a `project:create` committing between the
check and the delete makes the delete fail on the foreign key, which the action maps to the same typed error.
This is the one place the plan's convention of cascading tenant rows is deliberately inverted: a cascade from
organization to project would be exactly an organization-level permission over project data.

### Invites stay project-level

`invite:create` is unchanged except that it denormalizes `organizationName` beside `projectName`, so the
invitee's card says where they are going without a join. `invite:accept` ensures the organization membership in
its existing transaction. Membership in the organization is a consequence of joining a project, never a
substitute for it.

### Audit

`audit_logs` gains `organizationId` — nullable, no foreign key, for the same reason `projectId` has none.
`insertAuditLog` fills it from, in order, `auditOrganizationId`, the organization the middleware loaded, or the
loaded project's `organizationId`, so every project row also records its organization. Organization actions
write rows with a null `projectId`.

`organization-audit:list` (owners only) returns rows with this `organizationId` and a null `projectId`, plus
`project:create` and `project:delete` — the directory's own history. It never returns a row from inside a
project: a `tag:create` in a project the owner is not in stays in that project's log.

### The backfill

Staging has users and projects by now. One migration, generated and then hand-edited — the same shape as
ToolExec's `0015` — adds the tables and a nullable column, runs the backfill between `-- backfill:begin` and
`-- backfill:end` markers, then sets `NOT NULL`, the `RESTRICT` foreign key, and the index:

1. Every existing user gets a personal organization, "`<name>`'s Organization", as its owner — exactly what
   signup would have made.
2. Each project goes to the personal organization of its creator: the user on its earliest `project:create`
   audit row, if they are still a member; otherwise its lowest-id `admin`; otherwise its lowest-id member.
   A project with no members at all gets an organization of its own, with no owner, and is listed in the
   migration's `RAISE NOTICE` for [phase 18](./phase-18-operations.md)'s orphan handling.
3. Every project membership yields a non-owner organization membership, `ON CONFLICT DO NOTHING`.
4. `project_invites.organization_name` and `audit_logs.organization_id` are filled from the projects that still
   exist.

## Steps

### 1. Schema — `backend/schema/{organizations,organization_memberships}.ts`, changes to `projects`, `project_invites`, `audit_logs`

`organizations`:

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | Addresses an organization everywhere |
| `name` | `varchar(256)` | Required, 3–256 characters |
| `slug` | `text` | Generated from the name; **not** unique, like `projects.slug` |
| `createdAt`, `updatedAt` | `timestamp(withTimezone)` | `defaultNow()`, `$onUpdateFn` |

`organization_memberships`:

| Column | Type | Notes |
|---|---|---|
| `organizationId` | `integer` → `organizations.id` | `ON DELETE CASCADE` |
| `userId` | `integer` → `users.id` | `ON DELETE CASCADE` |
| `owner` | `boolean` | Default `false` |
| `createdAt`, `updatedAt` | `timestamp(withTimezone)` | |

Indexes: `uniqueIndex(organizationId, userId)`; `index(userId)` for the switcher; a partial
`index(organizationId) WHERE owner` for the last-owner count.

Changes: `projects.organizationId` `integer NOT NULL` → `organizations.id` **`ON DELETE RESTRICT`**, with
`index(organizationId)`; `project_invites.organizationName` `text NOT NULL`; `audit_logs.organizationId`
`integer`, nullable, no FK, with `index(organizationId, createdAt)` for the activity log. The migration is
`backend/drizzle/NNNN_organizations.sql`, ordered as the backfill section says.

### 2. Ops — `backend/ops/{OrganizationOps,ProjectOps,MembershipOps,AuditOps,InviteOps}.ts`

```ts
/** Insert an organization and its first owner. Must run inside the caller's transaction. */
export async function createOrganizationForOwner(tx: TxHandle, userId: number, name: string)
/** Insert a non-owner membership if none exists. Idempotent. */
export async function ensureOrganizationMembership(tx: TxHandle, userId: number, organizationId: number)
/** Lock the user's row, then delete it if it is not an owner row and no project membership remains in the org. */
export async function pruneOrganizationMembership(tx: TxHandle, userId: number, organizationId: number)
/** Owner user ids, counted under FOR UPDATE — the last-owner guard. */
export async function getOwnerUserIds(tx: TxHandle, organizationId: number): Promise<number[]>
/** The API shape: epoch-ms timestamps, plus the caller's standing when given. */
export function serializeOrganization(org: Organization, standing?: OrganizationStanding)
```

`createProjectForOwner` takes `organizationId`. `serializeProject` adds `organizationId`. `serializeInvite` and
`serializeAuditLog` add the organization fields.

### 3. Middleware — `backend/middleware/rbac.ts`

`RBAC_LEVELS` becomes `["none", "member", "admin", "org-member", "org-owner"]`, documented as two scopes rather
than one ladder. `OrganizationMemberMiddleware()` and `OrganizationOwnerMiddleware()` are factories carrying
their own `RBAC_DESCRIPTOR`, built on `loadOrganizationAccess(params, connection, { requireOwner })`, which
requires a numeric `params.organizationId` and writes `organization` and `organizationMembership` onto
`connection.metadata`. `loadProjectAccess` is untouched — that is the invariant — and gains a JSDoc sentence
saying it must never read organization tables.

### 4. Actions — `backend/actions/organization/*.ts` and changed project actions

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `organization:create` | `PUT /organization` | rate limit, session | yes | yes |
| `organization:view` | `GET /organization` | `OrganizationMemberMiddleware()` | — | yes |
| `organization:list` | `GET /organizations` | session — the caller's own, paginated, with `owner` | — | yes |
| `organization:edit` | `POST /organization` | `OrganizationOwnerMiddleware()` | yes | yes |
| `organization:delete` | `DELETE /organization` | `OrganizationOwnerMiddleware()` — refused while projects remain | yes | yes |
| `organization-member:list` | `GET /organization/members` | `OrganizationOwnerMiddleware()`, paginated | — | yes |
| `organization-member:edit` | `POST /organization/member` | `OrganizationOwnerMiddleware()` — `owner` flag, last-owner guard | yes | yes |
| `organization-audit:list` | `GET /organization/audit-logs` | `OrganizationOwnerMiddleware()`, paginated, action and date filters | — | yes |

`organization:view` returns the organization, the caller's standing (`isMember`, `isOwner`), the projects the
caller belongs to, and — for owners only — the directory of every project with an `isMember` flag. Member
emails are owner-only: a member of one project does not learn who is in another.

Changed: `user:create` returns `organization` too; `project:create` takes `organizationId` and moves from
session-only to `OrganizationOwnerMiddleware()`; `project:view` and `project:list` carry `organizationId` and
`organizationName`, and `project:list` takes an optional `organizationId` filter; `invite:accept` and
`membership:create` ensure, and `membership:delete` and `project:delete` prune, organization membership.
Every organization action has a web route and none is machine ingress, so the publish policy makes all of them
MCP tools — including `organization:delete`, consistent with `project:delete`, and harmless because it only
ever deletes an empty organization.

### 5. Frontend — `frontend/src/context/AuthContext.tsx`, `components/Layout.tsx`, `pages/organization/*`

- `AuthContext` loads `organization:list` beside `project:list` and keeps `activeOrganizationId`, persisted as
  `botholomew.activeOrganizationId`, under one invariant: the active project belongs to the active
  organization. Switching organizations moves to that organization's newest project the caller belongs to, or,
  for an owner with none, to its settings. A stale selection self-heals as `activeProjectId` already does.
- `Layout`'s breadcrumb becomes `Botholomew / <organization ▾> / <project ▾>`. The organization menu lists the
  caller's organizations with an owner badge and "New organization"; the project menu lists the active
  organization's projects and offers "New project" only to its owners, gated by `can()` with organization
  standing from the server.
- `ProtectedRoute`: no organization → `/organizations/new`; organizations but no project → `/projects/new`.
- New pages: `NewOrganizationPage`, and `OrganizationSettingsPage` at `/organization/settings/<section>` on the
  sections framework — **General** (rename), **Members** (owners only: people, emails, the owner toggle),
  **Projects** (the directory, with "you are not a member" where true), **Activity** (owners only), and **Danger**
  (delete, disabled with the reason while projects remain).
- `NewProjectPage` gains an organization select listing only the organizations the caller owns. `InvitesPage`
  cards show the organization name.

### 6. CLI — `cli/src/commands/org.ts`, `cli/src/commands/project.ts`

| Command | Wraps |
|---|---|
| `botholomew org list` | `organization:list` |
| `botholomew org view` | `organization:view` |
| `botholomew org create <name>` | `organization:create` |
| `botholomew org edit --name <name>` | `organization:edit` |
| `botholomew org delete --yes` | `organization:delete` |
| `botholomew org use <id-or-slug>` | writes `organization` into the CLI config |
| `botholomew org member list` / `org member edit <email> --owner \| --no-owner` | `organization-member:list` / `:edit` |
| `botholomew org audit [--action] [--since]` | `organization-audit:list` |
| `botholomew project create <name> [--org <id-or-slug>]` | `project:create` |

A global `--org <id-or-slug>` and `BOTHOLOMEW_ORG` join `--project`. `project create` resolves its organization
from `--org`, then the configured organization, then the current project's organization, then the single
organization the caller owns; otherwise it stops and lists the organizations they own.

### 7. User docs — `frontend/src/content/docs/organizations.md`, `teams.md`, `getting-started.md`, `security.md`, `cli.md`, `mcp.md`

A new **Organizations** page, registered in `sections.ts`: what an organization is, owners, the personal
organization, creating and deleting, and — in its own heading — that organizations grant no access to
projects. `security.md` states the invariant in one paragraph; `teams.md` explains that invites are to projects
and bring organization membership with them; `getting-started.md` describes signup's personal organization;
`cli.md` and `mcp.md` gain the new commands and tools.

### 8. Tests — `backend/__tests__/`, `frontend/e2e/`

`backend/__tests__/setup.ts`: every `TestUser` carries the `organizationId` of their personal organization, and
`TestUniverse` gains `organizationId` (Peach's, holding the shared project) and **Daisy** — invited to the
shared project, accepted, made an owner of Peach's organization, then removed from the project, all through
real HTTP. Daisy is an owner of the organization with no membership in any of its projects; Bowser remains an
outsider to both.

`backend/__tests__/actions/organization.test.ts`:
- Signup creates exactly one organization owned by the user, one project inside it, and two audit rows.
- `organization:list` returns only the caller's organizations, with `owner`, honoring `limit` and `page`.
- Owners rename; Mario (member) and Bowser (outsider) get 403 on `organization:edit`.
- `organization:delete` with projects remaining is a typed refusal naming the count; after Peach deletes the
  shared project, it succeeds and the memberships cascade.
- The last owner cannot be cleared; `organization-member:edit` refuses a user who is not a member.
- `project:create` in Peach's organization: Peach and Daisy succeed, Mario gets 403, a missing
  `organizationId` is a validation error.

`backend/__tests__/actions/organization-boundary.test.ts` — the invariant, asserted as a whole set:
- Daisy gets 403 from `project:view`, `membership:list`, `tag:list`, `invite:list`, `audit:list`,
  `project:edit`, `tag:create`, `invite:create`, and `project:delete` on the shared project.
- Through MCP with Daisy's token, `project-view` and `membership-list` on the shared project are refused while
  `organization-view` succeeds and shows the project as a directory entry with `isMember: false`.
- From `actions:permissions`: every action whose inputs include `projectId` declares `member` or `admin`; every
  action whose inputs include `organizationId` declares `org-member` or `org-owner`; none declares both.
- `organization-audit:list` for Peach contains `project:create` for the shared project and none of the
  shared project's `tag:create` or `invite:accept` rows.

Extended suites: `invite.test.ts` — accepting creates the organization membership once, and accepting a second
project in the same organization does not add another; `membership.test.ts` — removing a non-owner's last
project in the organization prunes their row, an owner's row survives, and two concurrent removals from two
projects (fired together, repeated) never leave an orphan row; `project.test.ts` — `project:delete` prunes;
`audit.test.ts` — organization rows have a null `projectId`, project rows carry both ids; `rbac.test.ts` — the
two new levels are reported and enforced.

`backend/__tests__/schema/organizations-backfill.test.ts`: in a transaction that is rolled back, reshape seeded
data to the pre-organization state (nullable column, organizations removed), run the migration's marked block,
and assert one owned personal organization per user, each project in its creator's organization, the admin and
member fallbacks, a member-less project in an owner-less organization, and no null `organization_id` left.

`backend/__tests__/cli/cli.test.ts`: `org create`, `project create --org`, a refused `org delete`, then a
successful one. `frontend/e2e/organizations.spec.ts`: signup lands in the personal organization; create a second
organization and a project in it; the switcher moves between them; Danger is disabled with the reason while a
project remains and works once it is gone.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, in two browsers:

1. Sign up as Peach. The navbar reads `Botholomew / Peach's Organization / Peach's Project`.
2. Create a project "Castle" from the project menu — the organization select offers only Peach's organization.
3. Invite Mario to "Castle"; sign up as Mario in the second browser and accept. Mario's organization menu now
   lists his own organization and Peach's, without an owner badge on Peach's, and Peach's project menu for him
   shows only "Castle".
4. As Peach, make Mario an owner in Organization → Members, then remove him from "Castle" in its project
   settings. Mario still sees Peach's organization; opening "Castle" by URL is refused; Organization → Projects
   lists "Castle" with "you are not a member".
5. As Mario, try Organization → Danger → Delete: disabled, naming two projects.
6. As Peach, delete both projects, then the organization. Mario's switcher no longer lists it.
7. `botholomew org list`, `botholomew project create Garden --org <Peach's new org>`, `botholomew org audit`.

Then the edge cases:

- Clearing the last owner is refused, from the UI and from the CLI.
- An organization that has just had its last project deleted can be deleted; one with a project created a
  moment ago cannot, even if the page was loaded before that project existed.
- A pending invite card shows both the project and the organization name.
- On staging, after deploy: every pre-existing user has a personal organization, every project has an
  organization, and the migration's notice lists any member-less project.
- Claude connected as Mario lists organizations through MCP and cannot read "Castle" after step 4.

## Definition of done

- [ ] `organizations` and `organization_memberships` with the unique, switcher, and owner indexes
- [ ] `projects.organizationId` `NOT NULL` with `ON DELETE RESTRICT`; staging backfilled; the backfill test passes
- [ ] Signup creates the personal organization and first project in one transaction, with two audit rows
- [ ] `createProjectForOwner` takes an organization; `project:create` requires an owner of it
- [ ] Organization membership is maintained by every project-membership writer, with `FOR UPDATE` pruning
- [ ] Last-owner guard; owners may belong to no project
- [ ] No project-scoped action reads organization tables; the boundary suite proves it for an owner outside the project
- [ ] Eight `organization*` actions with RBAC descriptors, audit where they write, MCP tools by policy
- [ ] `audit_logs.organizationId`; the activity log shows organization rows and the project directory's history only
- [ ] Organization switcher, settings sections, new-organization page; project creation offers owned organizations only
- [ ] `botholomew org …` and `project create --org`
- [ ] Organizations user doc; security, teams, getting-started, CLI, and MCP docs updated

## Commands

```bash
botholomew org list --json
botholomew org create "Mushroom Kingdom"
botholomew project create "Castle" --org mushroom-kingdom
botholomew org member edit mario@mushroom.kingdom --owner
botholomew org audit --since 7d
curl -s localhost:8080/api/actions/permissions | jq '.permissions | with_entries(select(.key | startswith("organization")))'
psql botholomew -c "select o.name, count(p.id) from organizations o left join projects p on p.organization_id = o.id group by o.id;"
```

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then
the plan above is the only account.
