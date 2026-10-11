# Teams, tags, and audit

A **project** is the tenant and the privacy boundary. Everything multiplayer — membership, tags, invites, and the audit log — belongs to one project, and nothing in one project is visible from another.

Project administration lives under **Project** in the navbar: **Settings**, **Invites**, and **Audit**.

## Members and admins

There is no role ladder. There are two gates:

| Level | Means | Can |
| --- | --- | --- |
| **Member** | Holds a membership in the project | Read the project, its members, and its tags |
| **Admin** | Additionally holds the reserved **`admin`** tag | Everything a member can, plus rename or delete the project, add and remove members, create, rename, and delete tags, grant and revoke them, send invites, and read the audit log |

Signup makes you the admin of your first project, and creating a project makes you the admin of that one too.

A project always keeps somebody who can recover it: the **last admin** cannot be removed from the project, and the `admin` tag cannot be revoked from them. Make another member an admin first, or delete the project.

## Tags

Tags are project-scoped labels granted to members — `operators`, `viewers`, `on-call`, whatever your team needs. Names are matched trimmed and lowercased, so `Operators` and `operators ` are the same tag.

The reserved `admin` tag is the admin gate. Every project has it; it cannot be created, renamed, or deleted, and no other tag can be renamed to `admin`. Deleting any other tag revokes it from everyone who holds it.

Admins manage tags under **Settings → Tags**, and grant or revoke them per member under **Settings → Members**.

## Invites

Admins invite people by email under **Project → Invites**, optionally choosing tags the person receives when they accept. Invites:

- Send no email — the invite appears on the invitee's own **Invites** page, under **Pending for you**, once they sign in with that address
- Can be accepted or rejected only by the signed-in user whose email they name
- Expire after **five days**, and expired invites are swept away daily

**Invites this project has sent** lists every invite and its status for admins.

To add somebody who already has an account, skip the invite: **Settings → Members → Add member** takes their email.

## Permissions in the UI

`GET /api/actions/permissions` (no sign-in required) lists every action and what it requires: nothing, membership, or the `admin` tag. The website reads that map together with your standing in the project to decide which controls to show, so a button appears exactly when the API would accept the request behind it.

## Audit log

**Project → Audit** (`/audit`) is for admins. It records every change a person makes to the project — creating or renaming it, adding and removing members, creating and deleting tags, granting and revoking them, and sending, accepting, and rejecting invites — and each row is written in the **same database transaction** as the change it describes, so the log and the data cannot disagree.

- Each row names the action, who did it, when, and what it changed
- Before and after snapshots are recorded without secrets, and sensitive parameters (passwords, tokens, keys) are scrubbed before a row is written
- Filter by date range (**From**, **To**) and by **Action**; changing a filter, pressing Reset, or switching projects starts again on page 1
- Audit rows outlive what they describe: deleting a member, a tag, or the whole project leaves its history in place
- Rows older than the deployment's retention window (90 days by default) are swept away daily

## Related

- [Getting started](/docs/getting-started)
- [Security](/docs/security) — the boundary these gates enforce
- [CLI](/docs/cli) — the same operations from a shell
