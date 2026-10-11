# What is Botholomew?

Botholomew 2.0 is a cloud service of always-on bot swarms. Every project has a team of bots — one **leader** and any number of **workers** — that share the project's memory, MCP servers, and skills, and that people reach from the website, the CLI, Slack, and iMessage. The bots are in development; none of them is built yet.

What runs today is the platform underneath them: accounts, projects, the people in a project and what they may do, an audit log of every change a person makes, an MCP endpoint for your own assistant, and a command line. That is what these docs describe.

Looking for the local, single-user Botholomew? That is **v1**, a CLI and TUI agent that runs on your own machine. It lives on the [`v1` branch](https://github.com/evantahler/botholomew/tree/v1).

## Core ideas

| Term | Meaning |
| --- | --- |
| **Project** | Your tenant and your privacy boundary. Members, tags, invites, and audit history all belong to one project. |
| **Member** | A person who belongs to a project. Membership is what lets someone read it. |
| **Admin** | A member who also holds the reserved `admin` tag. Admins rename and delete the project, manage its people and tags, send invites, and read the audit log. |
| **Tag** | A project-scoped label granted to members. `admin` is the one reserved tag; every other tag is yours to name. |
| **Invite** | An offer to join a project, addressed to an email and optionally carrying tags. It appears in the invitee's app and expires after five days. |
| **Audit log** | The record of every change a person makes to a project, written in the same transaction as the change. |
| **MCP** | [Model Context Protocol](https://modelcontextprotocol.io/). Botholomew hosts an OAuth-protected MCP server, so Claude or an IDE can act for you. |

## What you can do

- **Sign up** and land in your own project as its admin — see [Getting started](/docs/getting-started)
- **Bring your team** with invites, and organize them with tags — see [Teams & audit](/docs/teams)
- **Read the audit log** of who changed what, with before and after
- **Connect your assistant** over MCP to manage projects, members, tags, and invites — see [MCP](/docs/mcp)
- **Work from a shell** with the `botholomew` CLI — see [CLI](/docs/cli)

## Where to go next

- **API reference** — the account menu links to the API's OpenAPI document: every HTTP endpoint with its inputs and responses
- **Status** — the account menu's Status page reports whether the API, its database, and Redis are healthy
- [Getting started](/docs/getting-started) — sign up, rename your project, and invite someone
- [Security](/docs/security) — the boundary the platform enforces
