# MCPX integration

Botholomew has no network, no shell, and no filesystem access on its
own. Everything external — reading email, searching the web, talking to
GitHub — comes from MCP servers, managed per project via
[**MCPX**](https://github.com/evantahler/mcpx).

Think of MCPX as the `package.json` of the agent's tools: a
project-local manifest (`.botholomew/mcpx/servers.json`) lists the MCP
servers this project can use, and the daemon connects to them at
startup.

You have two options for *how* those servers run:

- **Run individual servers yourself.** Point MCPX at a stdio command
  (`npx ...`) or a remote HTTP endpoint. Good for a handful of
  well-known integrations.
- **Use an MCP gateway.** A gateway like
  [Arcade.dev](https://www.arcade.dev/) exposes hundreds of
  authenticated tools (Gmail, Google Drive, Slack, GitHub, Notion,
  Linear, …) behind one endpoint, handles OAuth for you, and is
  maintained centrally. Configure it once and Botholomew sees the full
  tool surface.

---

## Configuration

`.botholomew/mcpx/servers.json` uses the standard MCP client config
format:

```json
{
  "mcpServers": {
    "gmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gmail"],
      "env": {}
    },
    "arcade": {
      "url": "https://api.arcade.dev/mcp/engineering",
      "headers": {
        "Authorization": "Bearer arc_xxxxxxx",
        "Arcade-User-ID": "you@example.com"
      }
    }
  }
}
```

Stdio entries launch a subprocess and speak MCP over pipes. Entries
with a `url` connect to a remote MCP server — this is the shape Arcade
(and most hosted MCP gateways) expect: a gateway endpoint plus
`headers` for auth. See [Arcade's docs](https://docs.arcade.dev/mcp-servers)
for the list of gateway URLs and how `Arcade-User-ID` scopes tool
access per user. MCPX accepts both shapes.

---

## Managing servers from the CLI

```bash
botholomew mcpx list                 # configured servers + connection status
botholomew mcpx add gmail            # add interactively
botholomew mcpx remove gmail
botholomew mcpx tools                # list every tool from every server
botholomew mcpx tools gmail          # filter to one server
botholomew mcpx test gmail.search '{"query":"test"}'   # dry-run a tool call
```

`mcpx test` is the fastest way to confirm a server is wired up before
handing it to the agent.

---

## Lifecycle

`createMcpxClient(projectDir)` in `src/mcpx/client.ts`:

1. Reads `servers.json`.
2. Connects to every server.
3. Returns an `McpxClient | null` (`null` if no servers are configured).

The daemon holds the client for its entire lifetime and calls
`client.close()` on SIGTERM/SIGINT. CLI commands like
`botholomew mcpx test` open a client, do their work, and close it.

---

## How the agent sees MCP tools

Rather than flood the model's tool list with every MCP tool from every
server — which can easily be hundreds — Botholomew exposes a small set
of **meta-tools** the agent uses to discover and invoke MCP tools
dynamically:

| Tool | Purpose |
|---|---|
| `mcp_list_tools` | List MCP servers and the tools they provide |
| `mcp_search` | Semantic search across all MCP tool names + descriptions |
| `mcp_info` | Get the JSON Schema for a specific tool's input |
| `mcp_exec` | Execute a tool with validated input |

So the agent's flow to "check my email" looks like:

```
 mcp_search("read email") ────► returns gmail.list_messages, gmail.get_message, ...
 mcp_info("gmail.list_messages") ──► returns input schema
 mcp_exec("gmail.list_messages", { maxResults: 10 }) ──► actual email
```

This keeps the primary tool list small and lets you plug in dozens of
MCP servers without blowing the context window.

See `src/tools/mcp/*.ts`.

---

## Logging

Every MCP call is logged to the current thread as a `tool_use` /
`tool_result` interaction pair — identical to how built-in tools are
logged. Duration and token counts are captured. Query the `interactions`
table (or run `botholomew thread view`) to see exactly what the agent
sent and got back.

---

## When to add a server

You want an MCP server when:

- The agent needs to reach a specific service (Gmail, Slack, GitHub,
  Linear, Notion).
- You want to give the agent *write* access somewhere — sending
  messages, creating issues, editing docs.
- You're ingesting remote content into context — Firecrawl for web
  pages, Google Docs MCP for docs, etc.

You don't need a server when:

- The work happens entirely in `.botholomew/` (the virtual filesystem,
  embeddings, tasks, schedules).
- You just want Claude to *read* something you already put in context —
  `file_read` / `search_semantic` are enough.
