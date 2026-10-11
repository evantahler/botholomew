# MCP

Botholomew hosts an OAuth-protected [MCP](https://modelcontextprotocol.io/) server, so your own assistant — Claude, an IDE, any MCP client — can work with Botholomew as you. It signs in with your Botholomew account and can do exactly what you can do on the website: no more, because the server checks the same membership and `admin` tag for every tool call.

## Connect a client

1. Sign in and open **Project → Settings → MCP endpoint**
2. Copy the URL. It is the API's origin followed by `/mcp` — for a local API, `http://localhost:8080/mcp`
3. Add it to your client as a remote MCP server (in Claude, a custom connector)
4. Your client opens a Botholomew sign-in page. Sign in with your Botholomew email and password, and approve the client

The URL comes from the server, not from your browser's address bar, because the API and the website can live on different hosts. If the section says the MCP server is switched off, the deployment you are using has turned it off and the endpoint answers nothing.

The address is not a secret: anyone who connects signs in as themselves and sees only what their own account allows.

## The tools

A connected client sees one tool per action a signed-in person can take, named for the action with `:` turned into `-`:

| Area | Tools |
| --- | --- |
| You | `me-view`, `user-edit` |
| Projects | `project-list`, `project-view`, `project-create`, `project-edit`, `project-delete` |
| Members | `membership-list`, `membership-create`, `membership-delete` |
| Tags | `tag-list`, `tag-create`, `tag-edit`, `tag-delete`, `user-tag-assign`, `user-tag-remove` |
| Invites | `invite-list`, `invite-list-pending`, `invite-create`, `invite-accept`, `invite-reject` |
| Audit | `audit-list` |

Each tool carries the action's description and input schema, so the model knows what it does and what to pass. Project-scoped tools take a `projectId`; ask your assistant to list your projects first. A tool that needs the `admin` tag is refused for a member who does not hold it, exactly as the website refuses them.

**Never tools, for anyone:** signing up, signing in and out, the unauthenticated status, API description, and permissions endpoints, and the background clocks that sweep expired invites and old audit rows.

Changes your assistant makes are audited like any other: the [audit log](/docs/teams) records them as yours.

## Try it

Once connected, ask your assistant something like:

- "List the members of my project."
- "Create a tag called operators and grant it to Mario."
- "Invite luigi@example.com to my project with the viewers tag."
- "What changed in my project's audit log this week?"
