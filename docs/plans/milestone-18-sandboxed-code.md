# Milestone 18: Sandboxed TypeScript over the membot index

## Context

Milestone 15 added `membot_query` so an agent could reduce a large JSON entry
without pulling it into the conversation. JSONata is safe and token-efficient,
but it is a second, unfamiliar language and becomes awkward for joins, branching,
intermediate values, and multi-step analysis.

At the time, arbitrary JavaScript or TypeScript was not a safe replacement:
`new Function` and `node:vm` do not isolate Bun globals, the filesystem, or the
network. A correct implementation would have required the process-level sandbox
deferred in GitHub issue
[#222](https://github.com/evantahler/botholomew/issues/222).

[Vercel's Run SDK](https://vercel.com/blog/introducing-run) changes that tradeoff.
It executes untrusted JavaScript or type-stripped TypeScript in a fresh,
hardened QuickJS context in a worker thread. Guest code has no Node/Bun globals,
filesystem, modules, environment variables, timers, or network. It can reach the
host only through explicitly supplied, serializing `hostFunctions`.

## Goal

- Replace `membot_query` and the `jsonata` dependency with one
  `membot_run` tool.
- Let the agent write ordinary TypeScript to read, combine, filter, aggregate,
  and write entries in the membot index.
- Expose a narrow MCP surface so one program can discover, call, capture, and
  reduce external tool results without sending intermediate blobs through the
  conversation.
- Apply the existing MCPX approval policy to every MCP call made by guest code.
- Preserve the project's core boundary: the agent still has no shell, host
  filesystem, ambient network, secrets, or direct database client.
- Keep the standing prompt cost small. Detailed API help is returned on demand
  and after actionable failures.

This milestone supersedes
[Milestone 15](./milestone-15-json-transforms.md). JSONata is removed rather
than retained as a compatibility shim.

## User experience

The LLM continues to use the normal Botholomew tool loop. `membot_run` is one
tool in that loop; this milestone does not replace the loop with AI SDK code
mode or expose every registered tool to guest code.

```text
agent → membot_run({
  source: `
    const messages = await files.readJson("mcp/inbox.json");
    return messages.reduce((counts, message) => {
      const day = message.created_at.slice(0, 10);
      counts[day] = (counts[day] ?? 0) + 1;
      return counts;
    }, {});
  `
})
      → { result: { "2026-08-29": 12, "2026-08-30": 4 },
          result_type: "object", result_count: 2 }
```

Top-level `await` and `return` are supported. Source may use JavaScript or
type-stripped TypeScript, but cannot import packages. Programs should return a
small answer or write a large result back through `files.writeJson`.

## Agent-facing tool

Add `src/tools/membot/run.ts`, register it from
`src/tools/membot/index.ts`, and remove `src/tools/membot/query.ts`.

### Input

| Field | Type | Meaning |
|---|---|---|
| `source` | string | JavaScript or type-stripped TypeScript function body. `?` returns the host API primer without starting a sandbox. |
| `output_logical_path` | string, optional | Store the returned value as JSON instead of returning it inline. |
| `change_note` | string, optional | Version note used with `output_logical_path`. |
| `max_input_bytes` | positive integer, optional | Per-file ceiling enforced by `files.readJson` and `files.readText`; default 20 MB. |

Run limits are application policy, not an agent-controlled input. Configure a
shared runner with explicit timeout, QuickJS memory, stack, source, result,
console, bridge-output, request-count, and concurrency limits. Do not let guest
source raise its own limits.

### Output

Use the same two success branches as `membot_query`:

- Inline: `result`, `result_type`, and `result_count`.
- Stored: `logical_path`, `version_id`, `bytes_written`, and a short `preview`.

Failures use the standard PAT envelope:
`is_error`, `error_type`, `message`, and `next_action_hint`. Stable error types
include `invalid_source`, `sandbox_timeout`, `sandbox_memory`,
`sandbox_limit`, `host_error`, `source_not_found`, `source_too_large`,
`invalid_json`, `mcp_error`, `approval_pending`, `write_failed`, and
`internal_error`. Map Run's stable error codes rather than parsing messages.

The description begins with:

```text
[[ bash equivalent command: bun -e '<source>' ]]
```

The tag gives the model a familiar code-execution analogy; no shell or Bun
runtime is exposed to the guest.

## Host API

Host functions are trusted application code. They receive `ToolContext`, use
`ctx.withMem` or `ctx.mcpxClient`, validate every argument, enforce bounds, and
return serializable values. No membot client, MCP client, function, stream,
credential, or arbitrary class instance crosses the QuickJS boundary.

Membot `logical_path` values are database keys, not filesystem paths, so these
functions do not use `resolveInRoot`. Guest code receives no function that takes
a host-filesystem path.

### `files`: membot entries

| Guest function | Host behavior |
|---|---|
| `files.readJson(logicalPath)` | Read the current markdown surrogate, enforce `max_input_bytes`, parse JSON, and return the value. Report `source_not_found` or `invalid_json` with a recovery hint. |
| `files.readText(logicalPath)` | Read the current surrogate as text under the same size ceiling. |
| `files.writeJson(logicalPath, value, changeNote?)` | Serialize with `JSON.stringify`, write a new membot version, and return only `{ logical_path, version_id, size_bytes }`. |
| `files.writeText(logicalPath, content, changeNote?)` | Write text as a new version and return the same small acknowledgment. |
| `files.exists(logicalPath)` | Return a boolean; a missing entry is not an exception. |
| `files.info(logicalPath)` | Return a bounded metadata subset: logical path, source, MIME type, size, current version, and refresh state. |
| `files.list(options?)` | List entries with optional `prefix`, required bounded `limit`, and `offset`; preserve membot's stable ordering. |
| `files.search(query, options?)` | Run hybrid search and return at most 20 bounded hits with path, score, and excerpt. |

Do not expose `delete`, `prune`, `move`, or line-patch editing in v1. Those are
destructive or already have explicit top-level tools. A program may create a
new version through the two write functions.

Run currently defaults each host-function output to 4 MiB, while
`membot_query` accepts inputs up to 20 MB. The implementation must explicitly
set a bridge-output limit high enough for the supported read ceiling and size
the QuickJS heap for the parsed value plus intermediate results. Keep the final
Run result bounded (1 MiB is a suitable initial ceiling); the existing
large-result parking mechanism remains a fallback, not the normal path.

### `mcp`: external tools

| Guest function | Host behavior |
|---|---|
| `mcp.listTools(server?)` | Return the same bounded server/name/description entries as `mcp_list_tools`. |
| `mcp.search(query)` | Search tool descriptions through the same implementation as `mcp_search`. |
| `mcp.info(server, tool)` | Return the complete tool input schema before the program constructs arguments. |
| `mcp.exec(server, tool, args?)` | Execute through the same MCPX client and approval policy as top-level `mcp_exec`. Return parsed JSON when the formatted result is valid JSON, otherwise text. |
| `mcp.capture(server, tool, args, logicalPath)` | Execute with the same gate, write the complete formatted result to membot, and return a storage acknowledgment without transferring the payload into QuickJS. |

Share the dispatch, validation, error classification, fake/capture-mode, and
approval code with `src/tools/mcp/exec.ts`; do not maintain a second policy
inside `membot_run`. Reject attempts to route top-level Botholomew tools through
MCP, as `mcp_exec` does today. Do not expose generic `fetch`, HTTP, sockets, or a
tool-by-name dispatcher.

The Run bridge defaults to 256 requests and 32 concurrent requests. Keep
explicit finite caps. The API primer tells the agent to capture once and compute
locally rather than call an MCP tool once per record.

## Approvals and continuations

A gated `mcp.exec` or `mcp.capture` cannot wait inside a host function for a
human: the sandbox timeout would expire and the worker thread would remain tied
up. Instead, the host function calls
`getHostFunctionContext().interrupt(...)` **before** performing the protected
effect. Run returns a continuation and the complete batch of interruptions.

On resume, the program is replayed deterministically. Settled host calls use
their recorded values, while the interrupted host function receives its
resolution and performs the MCP call only when approved. Run verifies source,
host-function names, arguments, and continuation context before replay.

### Chat

Adapt each interruption to the existing inline approval prompt. When the user
decides, resume the same source with the continuation and resolutions. Resolve
all interruptions in a concurrent batch together, as required by Run.

Use an application-managed continuation signer with at least 32 bytes of
entropy and a chat/session-scoped audience. The signer remains host-only.

### Workers

Persist the opaque continuation token and enough invocation metadata alongside
the pending `approvals/<id>.md` record. Bind the continuation context to at
least the project, task, thread, worker policy, and approval call key. A later
worker resumes the exact `membot_run` invocation after
`decideAndRequeue`; it must not ask the model to generate and execute a fresh
program.

Signed continuations provide integrity, not confidentiality: source, host-call
arguments, results, errors, and interruption payloads are encoded but not
encrypted. Store continuation data with the same local protections as approval
records and never render the token in agent output or logs. Prefer Run's stored
continuation codec if tokens become too large or contain sensitive tool
results.

An interrupted function is invoked again on resume, so interruption always
happens before a non-idempotent MCP effect. Where retries remain possible, use
the interruption id as the stable idempotency key when the target tool supports
one. Approval denial returns a structured permanent error and never executes
the call.

Dropping a continuation and letting the model retry is not an acceptable v1
fallback: it can repeat reads, lose deterministic state, or duplicate writes.

## Teaching the agent

Use three disclosure tiers so routine turns do not carry an API manual:

1. **Tool description, every turn.** Say that `membot_run` executes sandboxed
   TypeScript against `files` and `mcp`, should return a small result or write
   one to the index, can capture large MCP payloads without putting them in
   context, and returns the API reference for `source: "?"`.
2. **`HOST_API_PRIMER`, on demand or error.** Include all signatures,
   serialization and size rules, no-Node/no-import/no-fetch constraints,
   approval behavior, and worked examples for filtering, grouping, joining two
   files, concurrent reads, MCP discovery, and capture-then-reduce.
3. **System prompt.** Replace `LARGE_JSON_SECTION` in
   `src/worker/prompt.ts` with the `membot_pipe` / `membot_run` pattern. For
   multi-step fetch-and-reduce work, prefer one `membot_run` program over many
   conversational `mcp_exec` calls. Keep the existing instruction to search
   membot before fetching fresh external data.

Do not inject the configured MCP catalog into the tool description or system
prompt. The program discovers capabilities with `mcp.search` and obtains exact
schemas with `mcp.info`; it must not guess arguments from descriptions.

Add `membot_run` and remove `membot_query` in the chat tool allowlist. Worker
tool registration follows the shared registry.

## Implementation order

1. Add `run` with Bun and spike a minimal Run invocation in both development
   and the compiled binary.
2. Build bounded `files` host functions and unit-test every success/error
   branch.
3. Extract reusable MCP dispatch and approval behavior, then add `mcp` host
   functions.
4. Implement continuation persistence and chat/worker resume flows.
5. Add `membot_run`, its output/error envelope, primer, and prompt guidance.
6. Remove `membot_query`, `jsonata`, and their tests/docs; update tool counts and
   capability snapshots.

## Packaging risk

`run` uses worker threads and QuickJS assets. Before the feature is considered
viable, `bun run build` must prove that `dist/bothy` can create the worker and
resolve every runtime asset. This is the same class of binary-only risk already
handled for DuckDB and onnxruntime.

If Bun does not embed the worker or QuickJS asset correctly, stage the required
bytes from the compiled binary at startup in `src/cli-standalone.ts`, with
compiled-only behavior gated through `src/runtime.ts`. If no reliable staging
strategy exists, this milestone is blocked; falling back to `eval`, `node:vm`,
or an unsandboxed Bun subprocess is not acceptable.

## Out of scope

- Replacing the worker/chat agent loop with AI SDK code mode.
- Mapping all `ToolDefinition`s into guest globals.
- Guest access to tasks, schedules, prompts, skills, threads, workers, or the
  host filesystem.
- Package installation, shell commands, processes, or OS-level workloads. Those
  require Vercel Sandbox or another process-level isolation boundary.
- Keeping JSONata as a second transform language or compatibility shim.

## Verification

1. Unit tests for every `files` and `mcp` host function: bounds, malformed JSON,
   missing entries, pagination, result parsing, invalid tool inputs, MCP errors,
   and capture write failures.
2. Sandbox tests for TypeScript syntax, top-level await/return, joins,
   aggregation, concurrent host calls, syntax/runtime errors, infinite loops,
   memory exhaustion, bridge caps, oversized source/host/result values,
   cancellation, and forbidden globals (`process`, `Bun`, `fetch`, `require`,
   dynamic import, and dynamic evaluation).
3. Approval tests for chat approve/deny, worker park/resume, batched
   interruptions, continuation tampering/context mismatch, replay without
   duplicate host calls, and non-idempotent effects occurring only after
   approval.
4. End-to-end development run: capture a large MCP JSON result, reduce it in
   TypeScript, and confirm only the small result enters the conversation.
5. `bun run build`, then run the same end-to-end path with `dist/bothy` to prove
   worker and QuickJS asset loading.
6. `bun run lint`, `bun test`, and `bun run docs:build`.
