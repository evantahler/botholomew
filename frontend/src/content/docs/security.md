# Security

This page states the boundary Botholomew enforces today, for the platform that exists: accounts, projects, members, tags, invites, the audit log, and MCP.

## The project is the boundary

Every project-scoped request names a project, and the server checks the caller against that project before it does anything else. There are two gates and no role ladder:

- **Membership grants read.** A member can read the project, its members, and its tags. Somebody who is not a member gets nothing back from that project's endpoints — not its members, not its tags. (An invite does show its invitee the project's name, so they know what they are joining.) A project that does not exist and a project you are not in answer with the same refusal, so project ids cannot be probed.
- **The `admin` tag grants administration.** Renaming or deleting the project, adding and removing members, creating, renaming, deleting, granting, and revoking tags, sending invites, and reading the audit log all require the reserved `admin` tag in that project.

Admin in one project means nothing in another. Every check is a project check.

The gates are enforced by the API, not by the website. The website hides a control you cannot use, but the server is what refuses the request — from the website, the [CLI](/docs/cli), or an [MCP client](/docs/mcp) alike. `GET /api/actions/permissions` publishes what every action requires, so the rule is something you can read rather than infer.

A project always keeps an admin: the last admin cannot be removed, and the `admin` tag cannot be revoked from them.

## Audit rows outlive their subjects

Every change a person makes to a project is written to the audit log in the **same database transaction** as the change itself, so the log cannot record something that did not happen or miss something that did.

Audit rows deliberately carry no foreign key to the project, the member, or the tag they describe. Deleting a tag, removing a member, or deleting the whole project leaves the record of it — including the deletion — in place. Rows are removed only when they age past the deployment's retention window (90 days by default).

What a row records is scrubbed: before and after snapshots are the same serialized shapes the API returns, which never include a password or a credential, and parameters named like secrets (`password`, `token`, `apiKey`, and similar) are removed before the row is written.

## Credentials

- **Passwords** are stored only as an argon2id hash.
- **Sessions** are an HTTP-only cookie, `SameSite=Strict` by default, that expires after a day by default. The CLI keeps its copy of the cookie in a config file only you can read.
- **Credentials the server stores** are encrypted at rest with AES-256-GCM under the deployment's `SECRETS_ENCRYPTION_KEY`, and the server refuses to boot without a valid one. A misconfigured key is a failed deploy, never a credential written in the clear.
- **MCP clients** sign in through OAuth as the person using them, so a client holds a token for that person and can do only what that person can.

## Invites

An invite names one email address. Only the signed-in user with that address can accept or reject it, and it expires after five days. Accepting grants exactly the tags the admin chose when sending it.
