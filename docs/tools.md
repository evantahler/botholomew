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
| `terminal` | If `true`, the daemon ends the agent loop when this tool is called (e.g., `complete_task`, `fail_task`, `wait_task`) |
| `inputSchema` | Zod schema with `.describe()` per field — becomes JSON Schema for the model and Commander flags for the CLI |
| `outputSchema` | Zod schema guaranteeing the shape of the response |
| `execute` | The actual implementation, receiving validated input and a `ToolContext` |

---

## ToolContext

Every tool receives a `ToolContext`:

```ts
interface ToolContext {
  conn: DbConnection;            // DuckDB connection
  projectDir: string;             // absolute path to the project
  config: Required<BotholomewConfig>;  // resolved config (API keys, model, …)
  mcpxClient: McpxClient | null;  // external MCP tools (may be null)
}
```

This is the only capability surface. A tool that isn't handed an
`mcpxClient` can't reach the network; a tool that doesn't use `conn`
can't touch the database. The context is constructed once per
tick/session and passed to every `execute()` call.

---

## Anthropic adapter

`toAnthropicTools()` walks the registry and converts each Zod input
schema to the Anthropic SDK's `Tool` type using `z.toJSONSchema()`:

```ts
{
  name: "file_write",
  description: "Create or overwrite a file in the virtual filesystem.",
  input_schema: {
    type: "object",
    properties: { /* derived from Zod */ },
    required: ["path", "content"],
  }
}
```

`runAgentLoop()` feeds this array into `client.messages.create({ tools:
... })`. When the model emits a `tool_use` block, the loop looks up the
tool by name via `getTool(name)`, validates the input against
`inputSchema`, calls `execute()`, and returns the result as a
`tool_result` block.

Terminal tools (the ones with `terminal: true`) tell the loop to stop.
For the daemon, those are `complete_task`, `fail_task`, and `wait_task` —
any of which transitions the task out of `in_progress`.

---

## CLI adapter

`registerToolsAsCLI(program)` iterates the registry and generates a
Commander subcommand per tool, grouped by `group`:

```bash
botholomew file read /notes/meeting.md --offset 10 --limit 20
botholomew dir tree / --max-items 100
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
