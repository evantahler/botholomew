# The Tool class

Every tool the agent can call — and every matching CLI subcommand you
can run yourself — is defined once as a `ToolDefinition`. A single
definition drives three consumers:

1. **The Anthropic SDK** (via `input_schema: JSONSchema`) so the model
   can call it.
2. **Commander.js** via an auto-generated subcommand.
3. **Tests**, which import the tool directly and call `execute()`.

This lives in `src/tools/tool.ts`.

---

## Shape of a tool

```ts
import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  summary: z.string().describe("Summary of work done"),
});

const outputSchema = z.object({
  message: z.string(),
  is_error: z.boolean(),
});

export const completeTaskTool = {
  name: "complete_task",
  description:
    "Mark the current task as complete with a summary of what was accomplished.",
  group: "task",
  terminal: true,
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => ({
    message: `Task completed: ${input.summary}`,
    is_error: false,
  }),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
```

**Fields:**

| Field | Purpose |
|---|---|
| `name` | Snake-case identifier; also the CLI subcommand name |
| `description` | Used for both the LLM tool definition and CLI help text |
| `group` | Groups tools into CLI namespaces (`task`, `file`, `dir`, …) |
| `terminal` | If `true`, the agent loop ends when this tool is called (e.g., `complete_task`, `fail_task`, `wait_task`) |
| `inputSchema` | Zod schema with `.describe()` per field — becomes JSON Schema for the model and Commander flags for the CLI |
| `outputSchema` | Zod schema guaranteeing the shape of the response |
| `execute` | The actual implementation, receiving validated input and a `ToolContext` |

---

## ToolContext

Every tool receives a `ToolContext`:

```ts
interface ToolContext {
  conn: DbConnection;             // short-lived connection, scoped to this tool call
  dbPath: string;                 // for long-running tools that manage their own withDb
  projectDir: string;             // absolute path to the project
  config: Required<BotholomewConfig>;  // resolved config (API keys, model, …)
  mcpxClient: McpxClient | null;  // external MCP tools (may be null)
}
```

This is the only capability surface. A tool that isn't handed an
`mcpxClient` can't reach the network; a tool that doesn't use `conn` or
`dbPath` can't touch the database.

### `conn` vs `dbPath`

The executor (`runAgentLoop` / `runChatTurn`) wraps each tool call in
`withDb(dbPath, async (conn) => tool.execute(input, { ...ctx, conn }))`.
That means:

- `ctx.conn` is **already open** for the duration of one `execute()` call
  and will be closed immediately after. Use it for ordinary tools that
  do one or two quick queries.
- `ctx.dbPath` is for tools that run long enough that holding the file
  lock would block the worker or CLI (e.g., `context_refresh` re-fetching
  many URLs). Wrap each DB touch in
  `await withDb(ctx.dbPath, async (conn) => { … })` so the lock is
  released between items.

DuckDB holds the file lock at the instance level. A tool that hangs on
`ctx.conn` through a long network round-trip keeps that lock held. When
in doubt, prefer granular `ctx.dbPath` wrapping.

---

## Anthropic adapter

`toAnthropicTools()` walks the registry and converts each Zod input
schema to the Anthropic SDK's `Tool` type using `z.toJSONSchema()`:

```ts
{
  name: "context_write",
  description:
    "Write content to a context item. By default, fails if the (drive, path) already exists — pass on_conflict='overwrite' to replace.",
  input_schema: {
    type: "object",
    properties: { /* derived from Zod */ },
    required: ["drive", "path", "content"],
  }
}
```

`context_write` accepts an optional `on_conflict: "error" | "overwrite"`
input (default `"error"`). A collision returns `is_error: true`,
`error_type: "path_conflict"`, and a `next_action_hint` that steers the
model back to `context_read` or a retry with `on_conflict='overwrite'`.

`runAgentLoop()` feeds this array into `client.messages.create({ tools:
... })`. When the model emits a `tool_use` block, the loop looks up the
tool by name via `getTool(name)`, validates the input against
`inputSchema`, calls `execute()`, and returns the result as a
`tool_result` block.

Terminal tools (the ones with `terminal: true`) tell the loop to stop.
For workers, those are `complete_task`, `fail_task`, and `wait_task` —
any of which transitions the task out of `in_progress`.

---

## CLI adapter

`registerToolsAsCLI(program)` iterates the registry and generates a
Commander subcommand per tool, grouped by `group`:

```bash
botholomew context read disk:/Users/evan/notes/meeting.md --offset 10 --limit 20
botholomew context tree disk:/Users/evan/notes --max-depth 3
botholomew search semantic "quarterly revenue"
```

Positional args and `--options` are derived from the Zod schema shape.
The same validation that runs for the LLM runs here, so you get the same
error messages.

---

## Registry

Tools register themselves on import, so adding a tool is a one-file
change:

1. Create `src/tools/<group>/<name>.ts` exporting a
   `ToolDefinition`.
2. Add `registerTool(myTool);` to `src/tools/registry.ts`.
3. Write a test in `test/tools/<group>/<name>.test.ts`.

No central dispatch table to edit, no LLM tool list to update, no CLI
command to wire. The Zod schema is the source of truth.

---

## `pipe_to_context` — pipe a tool's output straight into context

Sometimes the agent wants a tool's full output to be searchable later but
doesn't actually need to *read* it. A web fetch, an `mcp_exec` that returns a
big JSON dump, a `search_grep` over a wide pattern — all of these can blow
through the conversation budget if the bytes round-trip through the LLM.

`pipe_to_context` is a meta-tool: you give it the *name and arguments* of
another tool, plus a destination `(drive, path)`, and it dispatches the inner
tool, captures the stringified result, and writes it directly to a context
item via the same ingest pipeline `context_write` uses (chunked + embedded +
indexed). The model only ever sees a small acknowledgment — id, drive, path,
byte count, and a 200-char preview — never the raw bytes.

```text
agent → pipe_to_context(tool_name="search_grep",
                         tool_input={...},
                         drive="agent",
                         path="/research/grep-results.txt")
        → { id, ref: "agent:/research/grep-results.txt",
            bytes_written: 184321, preview: "…" }
agent → context_search("the thing I actually wanted to know")
```

Two guards apply at the dispatch site:

- Terminal tools (`complete_task`, `fail_task`, `wait_task`) and
  `pipe_to_context` itself are rejected with `error_type: "forbidden_tool"`.
  Piping a terminal tool would let the loop end without the orchestrator
  seeing the result; recursion is meaningless.
- The inner tool's input is validated against its own `inputSchema` before
  dispatch, so bad arguments come back as `error_type: "invalid_input"`
  with field-level detail instead of an opaque crash.

If the inner tool returns `is_error: true`, **nothing is written** — the pipe
returns `error_type: "inner_tool_error"` with the inner message inlined (capped
at 2KB), so the agent can retry with different arguments.

---

## `capabilities_refresh` — the meta-tool

The `capabilities`-group tool `capabilities_refresh` exists so the
agent can keep its own tool inventory fresh. It walks `getAllTools()`
and `mcpxClient.listTools()`, then asks Claude (via
`chunker_model`) to produce a **thematic summary** — one line per
theme (e.g. "Gmail — read, send, draft, search, and reply to emails")
rather than a line per tool. The result is written to
`.botholomew/capabilities.md` (preserving frontmatter). Because that
file is loaded into every system prompt, the next boot picks up the
new inventory without another round-trip. Specific tool names are
intentionally absent from the rendered file; the agent uses
`mcp_list_tools` / `mcp_search` / `mcp_info` to look them up at
call-time. See
[persistent-context.md](persistent-context.md#capabilitiesmd--high-level-tool-inventory)
for when the agent should call it. The matching CLI surface is
`botholomew capabilities`, and the slash command is `/capabilities`.

---

## Why Zod for the schema?

Zod gives us three things at once:

- **Runtime validation.** Untrusted inputs (from the model, from the
  CLI) are validated before `execute()` runs. A malformed tool call
  becomes a clear `tool_result` error the model can recover from, not a
  crash.
- **TypeScript inference.** `z.infer<typeof inputSchema>` gives
  `execute()` a statically-typed `input` parameter.
- **JSON Schema export.** `z.toJSONSchema()` produces the schema the
  Anthropic API needs without a separate definition.

The entire adapter layer is ~80 lines (`src/tools/tool.ts`) because Zod
does the heavy lifting.
