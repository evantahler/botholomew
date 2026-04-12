# Milestone 4: MCPX Integration

## Goal

Give the daemon access to external tools via MCPX — the agent can read email, search the web, access APIs, etc. Operators manage which MCP servers are available per project.

## What Gets Unblocked

- The daemon can interact with the outside world (Gmail, Slack, GitHub, web search, etc.)
- Operators configure tool access per project via `botholomew mcpx` commands
- The agent's tool-use loop dispatches MCP tools alongside built-in tools

---

## Implementation

### 1. MCPX Library Integration (`src/mcpx/`)

New module for MCPX integration:

**`src/mcpx/manager.ts`**
- Import `@evantahler/mcpx` as a TS library
- `loadServers(projectDir)` — read `.botholomew/mcpx/servers.json`, initialize MCPX `ServerManager`
- `getAvailableTools(manager)` — list all tools from all connected MCP servers, converted to Anthropic `Tool` format
- `executeTool(manager, serverName, toolName, input)` — call a tool and return the result
- Handle server lifecycle: connect on daemon start, disconnect on shutdown

**`src/mcpx/convert.ts`**
- `mcpToolToAnthropicTool(mcpTool)` — convert MCP tool schema to Anthropic SDK `Tool` type
- `anthropicInputToMcpInput(input)` — convert tool call input formats if needed

### 2. Wire MCP Tools into Daemon (`src/daemon/llm.ts`)

Update `runAgentLoop`:
- Accept an MCPX manager instance
- Merge `DAEMON_TOOLS` with MCP tools from `getAvailableTools()`
- In `executeToolCall`, if the tool name isn't a built-in daemon tool, dispatch to `executeTool()` via MCPX
- Log MCP tool calls the same way as built-in tools (to interactions table)

### 3. MCPX Lifecycle in Daemon (`src/daemon/index.ts`)

Update `startDaemon`:
- After loading config and DB, initialize MCPX `ServerManager`
- Pass manager to each `tick()` call
- On shutdown, disconnect all MCP servers

### 4. MCPX CLI Commands (`src/commands/mcpx.ts`)

Replace stubs:

- `botholomew mcpx list` — list configured MCP servers and their status (connected/disconnected)
- `botholomew mcpx add <name>` — add an MCP server interactively (prompt for type: stdio/http, command/url, env vars)
  - Write to `.botholomew/mcpx/servers.json`
- `botholomew mcpx remove <name>` — remove an MCP server
- `botholomew mcpx tools [server]` — list available tools (optionally filtered by server)
- `botholomew mcpx test <tool> [input-json]` — execute a tool call and display the result
  - Useful for debugging tool configurations

### 5. MCPX Server Config Schema

Define the expected format for `.botholomew/mcpx/servers.json`:

```json
{
  "mcpServers": {
    "gmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/gmail-mcp"],
      "env": {}
    },
    "web-search": {
      "type": "http",
      "url": "https://mcp.example.com/search"
    }
  }
}
```

This mirrors the standard MCP client config format that MCPX already supports.

---

## Files Modified

| File | Change |
|------|--------|
| `src/mcpx/manager.ts` | **New** — MCPX server lifecycle management |
| `src/mcpx/convert.ts` | **New** — tool format conversion |
| `src/daemon/llm.ts` | Accept MCPX manager, merge tools, dispatch MCP calls |
| `src/daemon/tick.ts` | Pass MCPX manager through |
| `src/daemon/index.ts` | Initialize/shutdown MCPX manager |
| `src/commands/mcpx.ts` | Full CLI implementation |

## Tests

- `test/mcpx/convert.test.ts` — tool format conversion
- `test/mcpx/manager.test.ts` — server config loading (mock MCPX)
- `test/daemon/llm-mcpx.test.ts` — daemon dispatches MCP tools correctly (mock)

## Verification

1. `botholomew mcpx add gmail` — configure a Gmail MCP server
2. `botholomew mcpx tools` — shows all tools available from configured servers
3. `botholomew mcpx test gmail.search '{"query": "test"}'` — executes a tool call
4. Create a task "check my email" with a Gmail MCP server configured — daemon uses MCP tools to complete it
5. Interaction log shows MCP tool calls with input/output
