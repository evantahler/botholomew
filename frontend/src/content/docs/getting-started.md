# Getting started

## Sign up

Create an account at **Sign up** with your name (at least three characters), your email, and a password of at least eight characters. Signup creates your user **and** a project called *Your Name's Project* in one step, and makes you its admin by granting you the reserved `admin` tag. You land on that project's **Home**.

Signing in again later is **Sign in** in the account menu (your name, top right). By default a session lasts a day.

## Find your way around

- The **project switcher** beside the brand lists every project you belong to. Choose one to make it active; every page you open acts on the active project
- **New project** in the switcher creates another project. You are its admin
- **Home** is the active project's landing page
- **Project** opens **Settings**, **Invites**, and the **Audit** log
- **Docs** is this site, readable signed in or signed out
- The **account menu** holds your **Account** (name, email, password), the API reference, the Status page, the style guide, and **Sign out**

On a phone the navbar collapses behind the menu button, and Settings and Docs keep their sidebar behind a **Sections** disclosure so the page you opened is not buried under a column of links. Wide tables swipe sideways inside themselves rather than dragging the whole page.

## Settings

**Project → Settings** has five sections, each at its own URL under `/settings`:

| Section | What it holds |
| --- | --- |
| **General** | The project's name. Admins rename it; everyone else sees it |
| **MCP endpoint** | The address to give an MCP client — see [MCP](/docs/mcp) |
| **Members** | Who belongs to the project and which tags each holds. Admins add existing users by email, grant and revoke tags, and remove members |
| **Tags** | The project's tags. Admins create and delete them |
| **Danger zone** | Deleting the project. Admins only, and you type the project's name to confirm |

A section that holds an unsaved edit marks itself in the sidebar, and leaving it asks before throwing the edit away.

## Invite your team

Open **Project → Invites**. As an admin you can invite anyone by email and choose tags to grant when they accept. No email is sent: the invite appears on the invitee's own **Invites** page the next time they sign in, under **Pending for you**, with **Accept** and **Reject**. An invite expires after five days.

Somebody who already has an account can also be added directly from **Settings → Members** with **Add member**.

See [Teams & audit](/docs/teams) for tags, admins, and the audit log.

## Next

- [Connect your own assistant over MCP](/docs/mcp)
- [Use the CLI](/docs/cli)
- [Security](/docs/security) — what membership and the `admin` tag each grant
