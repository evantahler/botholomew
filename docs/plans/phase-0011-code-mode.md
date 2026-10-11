# Phase 11 — Code mode

> **Goal:** Every bot can write a short TypeScript program that reads and writes project memory and calls the
> project's MCP servers, run it in a QuickJS sandbox with no network, environment, or imports, and get back a
> small answer — so megabytes of tool output are reduced in code instead of pasted into context. A gated call
> inside a program pauses it for a person and resumes the same program, not a new one.

> **Status: planned, not built.** Stage C — Shared capabilities. Depends on
> [phase 4](./phase-0004-project-memory-core.md) (`MemoryOps`, write rules), [phase 6](./phase-0006-durable-bot-loop.md)
> (`tool_calls`, replay, the tick), [phase 8](./phase-0008-context-management.md) (scratch paths, offload),
> [phase 9](./phase-0009-memory-search-and-ingestion.md) (search), and
> [phase 10](./phase-0010-mcp-servers-and-approvals.md) (the MCP client, the policy, `approvals`).

v1's field notes put it plainly: big content is the normal case. One test pulls a few megabytes of JSON out of a
baby tracker, and the only affordable answer is to land the payload in storage and let the agent slice it with a
sandboxed program. v1 milestone 18 builds that as `membot_run` on Vercel's Run SDK — QuickJS compiled to WASM,
running guest JavaScript or type-stripped TypeScript in a worker thread with no Node or Bun globals, reaching the
host only through supplied functions. 2.0 keeps the design and the limits, renames the tool `run_code`, and gives
it to every bot.

It sits here because [phase 10](./phase-0010-mcp-servers-and-approvals.md) makes MCP calls something a bot can make,
and the useful unit of work is rarely one call: it is "list everything from the last week, group it, join it with
what memory already says, and tell me the three that matter". As conversational tool calls that is a dozen model
steps with every payload in context; as one program it is one step and a small result.

Code mode is also what lets 2.0 skip ToolExec's sandbox VMs. ToolExec needs model and gateway proxies because
its agents are CLIs in VMs that would otherwise hold tokens. Here the guest is a program with no socket, no
environment, and no filesystem; its only door to an MCP server is a host function that attaches the credential
after the guest's arguments are serialized. Containment is a property of the shape, not of a proxy someone has to
keep correct. What this phase leaves out is anything process-shaped — shells, packages, git, builds. That needs a
real VM and is not planned.

## Scope

**In:** the `run_code` bot tool on npm `run` (vercel-labs/run, QuickJS via quickjs-wasi) with one runner per worker
process; host functions `memory.*` (`readJson`, `readText`, `writeJson`, `writeText`, `exists`, `info`, `list`,
`search`) under the calling bot's write rules and `mcp.*` (`listTools`, `search`, `info`, `exec`, `capture`) under
phase 10's policy; v1's limits as application policy; guest console discarded; approval interrupts before the
effect; continuations encrypted in Postgres and resumed on decision with Run's replay verification; an effect
ledger for crash safety; results inline or written to `output_logical_path`; errors mapped from Run's codes; a
primer generated from the host-function registry and per-tool signature hints from `mcp.info`; a process-wide
concurrency cap and an optional dedicated `code` queue; transcript and approval-card rendering; CLI; user docs.

**Out:** network access of any kind from the guest — no `fetch`, no URL ingest through `memory.*`, ever; URL
ingest is the top-level `memory_add` of [phase 19](./phase-0019-url-ingest.md). Destructive or structural memory
operations (`rm`, `mv`, `cp`, line patches) stay top-level tools. Guest access to threads, bots, tasks, skills, or
any other tool registry entry — v1 milestone 18 deliberately does not map every tool into the guest, and neither
does this. v1's `membot_pipe`, replaced by `mcp.capture` (below). Programs run by people rather than bots, and
guest state that persists between runs (use memory), are not planned.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| v1 `membot_run` | The tool shape: `source` (`?` returns the primer), `output_logical_path`, `change_note`, `max_input_bytes`; inline vs stored success branches; the approval-round cap | [src/tools/membot/run.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run.ts) |
| v1 sandbox invocation | `invokeSandbox`, `persistInterruptedRun`, `resumeStoredRun`, `describeResult`, `mapRunError`, the error-type list | [src/tools/membot/run/execute.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/execute.ts) |
| v1 host functions | `files.*` with bounds and `HostOpError` codes; `mcp.*` with interrupt-before-dispatch and fail-closed policy evaluation | [run/files.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/files.ts), [run/mcp.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/mcp.ts), [run/host.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/host.ts), [run/errors.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/errors.ts) |
| v1 limits | `RUN_LIMITS` and the input, list, search, and preview bounds, ported as values | [run/limits.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/limits.ts) |
| v1 continuations and primer | What to fix (signed-only tokens in a file beside the approval) and what to keep (the primer's rules and examples) | [run/continuation.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/continuation.ts), [run/primer.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/run/primer.ts) |
| v1 milestone 18 | The argued design: disclosure tiers, no catalog injection, interrupt before non-idempotent effects, packaging risk | [milestone-18-sandboxed-code.md](https://github.com/evantahler/botholomew/blob/v1/docs/plans/milestone-18-sandboxed-code.md) |
| v1 `membot_pipe` | The envelope bug `mcp.capture` fixes | [src/tools/membot/pipe.ts](https://github.com/evantahler/botholomew/blob/v1/src/tools/membot/pipe.ts) |
| Run SDK (npm `run`) | `createRunner` with `RunLimits`, `hostFunctions`, `getHostFunctionContext().interrupt` / `resume`, signed continuations bound to an audience and a `continuationContext`, batched interruptions, `RunError` codes | npm `run`, pinned at build time |
| Encrypted resumable state | Precedent for checkpoints that resume a conversation, AES-256-GCM under `SECRETS_ENCRYPTION_KEY` | `toolexec:backend/schema/agent_session_checkpoints.ts`, `toolexec:backend/ops/CryptoOps.ts` |
| Phase 10 | `McpClientOps.callTool`, `McpPolicyOps.evaluate`, per-call replay, `approvals` with decide-and-resume, structural classification | [phase 10](./phase-0010-mcp-servers-and-approvals.md) |

What does not exist: v1 writes the continuation to `approvals/<run_id>.run.json` in the project directory, signed
but not encrypted, so the token carries the program, every settled host result, and the interruption payloads in
the clear on disk. v1 also distinguishes chat (prompt inline, resume in-process) from workers (park the task);
2.0 has one path, because every bot parks its conversation.

## What this must not weaken

1. **The guest has no network, environment, filesystem, imports, timers, or dynamic evaluation.** Host functions
   are the only door, and none of them fetches a URL.
2. **No credential reaches the guest.** No host function returns a header, token, credential id, client object,
   or anything that could hold one.
3. **One policy.** `mcp.exec` and `mcp.capture` go through phase 10's allowlist, disabled tools, rules, and
   approvals — the same functions `mcp_exec` calls — and fail closed when the policy cannot be evaluated.
4. **Interrupt before the effect.** A gated call pauses before a byte is sent; a denied call never executes.
5. **The approved call is the call that runs.** On resume, Run verifies source, host-function names, and arguments
   against the continuation; divergence fails the run instead of executing anything.
6. **Continuations are secrets at rest.** Encrypted, bound to one conversation and call, never rendered, logged,
   returned to the model, or exposed by an action.
7. **The bot's memory write rules hold inside a program** exactly as they do for `memory_write`.
8. **Limits are application policy.** Neither guest source nor tool inputs can raise them.
9. **Postgres first.** The run's row exists before the sandbox starts; an unsafe effect's ledger row is committed
   before its request.

## Design

### One tool, one runner per worker

`run_code` takes v1's four inputs. The runner is created once per worker process with the limits below and a
continuation signer, rather than once per invocation as v1 does (re-reading a secret file each time). A
process-wide cap (`maxConcurrentRuns`, default 4) bounds QuickJS heaps per process; a call waits up to five
seconds for a slot, then fails `sandbox_busy`, which is retryable. Runs execute inline in the tick by default: the
30-second budget fits inside a tick, and the lease keeps renewing.

### The host API

| Guest function | Host behaviour |
|---|---|
| `memory.readJson(path)` / `readText(path)` | Current version of a logical path, under `max_input_bytes` (default 20 MB); `source_not_found`, `source_too_large`, `invalid_json` |
| `memory.writeJson(path, value, note?)` / `writeText(…)` | `MemoryOps.write` **as the bot**: reserved-path validation, namespace rules, `authorBotId`, change note defaulting to `run_code <toolCallId>`; returns `{ logical_path, version_id, size_bytes }`; a refused write is `write_refused` with the validator's hint |
| `memory.exists(path)` / `info(path)` | Boolean (a missing path is not an error) / bounded metadata |
| `memory.list({ prefix?, limit?, offset? })` | Phase 4 listing; limit default 50, max 200 |
| `memory.search(query, { limit?, path_prefix? })` | Phase 9 hybrid search; at most 20 hits; reserved paths excluded unless the prefix names them |
| `mcp.listTools(server?)` / `search(query)` | Phase 10's index, filtered to the bot's servers |
| `mcp.info(server, tool)` | Live schemas, annotations, `needs_approval`, and a generated `signature` |
| `mcp.exec(server, tool, args?)` | Policy, gate, and dispatch through `McpClientOps.callTool`; returns `structuredContent` when present, else parsed JSON text, else text |
| `mcp.capture(server, tool, args, path?)` | Same gate and dispatch; writes the payload to memory without it entering QuickJS; returns a write acknowledgment and a 200-character preview. `path` defaults to `scratch/conversations/<id>/mcp/<server>-<tool>-<n>.json`, which [phase 8](./phase-0008-context-management.md)'s retention sweeps |

Every argument is validated in the host; every value crossing the boundary is JSON-serializable; no function,
stream, or class instance crosses. Logical paths are database keys, not filesystem paths. There is no
`memory.add`: ingesting a URL is a network fetch, and the guest gets none.

### `mcp.capture` fixes the pipe's envelope bug

v1's `membot_pipe` stores `JSON.stringify(innerResult)`. Piping `mcp_exec` therefore writes mcp_exec's own envelope
— `{"result": "<the payload, as an escaped string>", "is_error": false, …}` — and `files.readJson` on the capture
returns the envelope with the data double-encoded inside it. `mcp.capture` writes the payload itself:
`structuredContent` as JSON when the server sent it, otherwise the text content, stored as `application/json` when
it parses and markdown otherwise. A tool error is thrown as `mcp_error`, never written as a file. `membot_pipe` is
not ported; capture-then-reduce inside one program replaces it.

### Limits

v1's values, as `backend/config/codeMode.ts` with operator environment overrides only:

| Limit | Value | Limit | Value |
|---|---|---|---|
| Timeout | 30 s | Host-function arguments / output | 22 MiB each |
| QuickJS heap | 96 MiB | Bridge requests per run | 256 |
| Stack | 2 MiB | In-flight bridge requests | 32 |
| Result | 1 MiB | Continuation | 32 MiB |
| Source | 256 KiB | Approval rounds per invocation | 16 |
| Console buffer | 64 KiB, discarded | `max_input_bytes` default | 20 MB |

Console output is never surfaced. The contract is "return a small value or write a large one"; a console channel
into the transcript would be a way to pour large data back into context, and v1 never surfaces it either.

### Approvals inside a program

Before any dispatch, the `mcp.*` host function evaluates phase 10's policy. A refusal throws `policy_error`. A gate
calls `interrupt({ kind: "approval", server, tool, args, message })` **before** a request exists; if the policy
cannot be evaluated (server unreachable for `tools/list`), it interrupts rather than dispatches, as v1 does. Run then
returns the continuation and the batch of concurrent interruptions.

In one transaction the worker encrypts the continuation into `code_runs`, inserts one `approvals` row per
interruption (`kind: call`, `codeRunId`, `interruptionId`, and the arguments in `payload`, since the `run_code`
call's own arguments are the source), moves the `run_code` call `started → awaiting_approval` — legal because the
interrupt preceded any effect — and leaves the conversation `waiting`. Each approval is decided exactly as in
phase 10. Run requires a batch to be resolved together, so the call returns to `approved` only when the last
approval in the batch is decided, whatever the individual decisions were; each decision becomes that
interruption's resolution. Tick step 3 decrypts and resumes: an approved host function performs its call with the
recorded arguments; a denied one throws `mcp_error` ("denied by …"), which the program may catch. A program that
interrupts again starts a new round, up to 16.

URL elicitation and reconnect inside a program use the same path: the server refused before executing, so the
host function interrupts with that gate's `kind` after the refusal. Form elicitation is answered `cancel`
immediately — a 30-second sandbox cannot wait for a person — and thrown as `elicitation_unanswered`, hinting
that the call be made with `mcp_exec`, where the wait exists.

### Continuations are encrypted, bound, and short-lived

Run's tokens are signed, which gives integrity and not confidentiality; v1's own docs say so and ask that the
approvals directory be treated as sensitive. Here the signing key is derived by HKDF from
`SECRETS_ENCRYPTION_KEY` (label `run-code-continuation/v1`, no new secret to provision), the audience is constant,
and `continuationContext` binds `{ v, projectId, botId, conversationId, toolCallId, codeRunId }`, so a continuation
from one conversation cannot resume in another. The token is then encrypted with `CryptoOps` (AES-256-GCM, fresh
IV) into `code_runs`. It never leaves the worker. Its ciphertext is nulled when the run completes, fails, or the
conversation is reset; [phase 18](./phase-0018-operations.md)'s key rotation re-encrypts or expires parked runs.

### Replay is verified, not trusted

On resume Run replays the program from the start: settled host calls return their recorded results — reads are not
repeated, writes not duplicated — and Run verifies that the program asks for the same host functions with the same
arguments. A program whose gated arguments depend on `Date.now()` or `Math.random()` therefore fails verification,
maps to `replay_diverged`, and executes nothing. That is the right failure: a person approved particular
arguments. The primer says to derive arguments from host data.

### The effect ledger

Blanket `unsafe` would make every crashed program an "outcome unknown", including the read-only majority. Instead
`run_code` keeps a ledger: before each MCP effect whose phase-10 replay class is `unsafe`, the host commits a
`code_run_effects` row `started`, and after it `succeeded` or `failed`. When tick step 3 finds a `run_code` call
`started` after a crash, it reads the ledger. No unsafe effect started: the program is re-run from its last
continuation or from source, which repeats only reads and same-content memory writes. Any unsafe effect started or
succeeded: the result is outcome unknown, listing each effect and its state, with a hint to verify before running
again. This is the [effect sandwich](https://earendil.com/posts/pi-durable/) applied inside the program.

### Errors are mapped from codes

| Run or host code | `error_type` |
|---|---|
| `RUN_TIMEOUT`, `RUN_ABORTED` | `sandbox_timeout` |
| `RUN_SOURCE_TOO_LARGE`, `RUN_DETACHED_BRIDGE_REQUEST` | `invalid_source` (the second with "await every host call") |
| `RUN_BRIDGE_LIMIT`, `RUN_CONCURRENCY_LIMIT` | `sandbox_limit` |
| `RUN_PROTOCOL_ERROR` | `replay_diverged` |
| `HostOpError` codes | passed through: `source_not_found`, `source_too_large`, `invalid_json`, `write_refused`, `write_failed`, `mcp_error`, `policy_error`, `elicitation_unanswered`, `host_error` |
| Slot not acquired | `sandbox_busy` (retryable) |

v1 falls back to message substrings for three conditions Run reports without a code: syntax errors, heap
exhaustion, and result or host-output overflow. Those are filed upstream for stable codes (the rule that framework
bugs go upstream applies to Run too); while Run lacks those codes, the three substring checks live in one function,
`classifyRunError`, pinned by tests to the `run` version, so an upgrade that rewords a message fails CI instead of
misclassifying. `approval_pending` is not an error type here: a gated program parks its conversation and the model
never sees a placeholder. Failures use the PATs envelope, and `invalid_source` and `host_error` carry the primer
in `next_action_hint`, as in v1.

### Teaching the bot

v1's three tiers. The description, every turn: `[[ bash equivalent command: bun -e '<source>' ]]` and one
paragraph. The primer, on `source: "?"` and after actionable errors, is **generated** from the host-function
registry — each host function declares its signature, one-line contract, and bounds — so it cannot drift from the
code, and a test asserts every registered function appears in it. The system prompt carries one paragraph: for
multi-step fetch-and-reduce work, prefer one program over many `mcp_exec` calls, and capture large results.
`mcp.info` (and `mcp_info`) return a `signature` generated from the tool's schemas, for example
`await mcp.exec("github", "list_issues", { owner: string; repo: string; state?: "open" | "closed" })`, which is
the per-server hint a program needs without any catalog entering the prompt.

### An optional `code` queue

At scale, QuickJS heaps (96 MiB each) compete with ticks for a worker's memory. With `CODE_MODE_QUEUE=code`, a
`run_code` call commits its `code_runs` row `queued` and the conversation waits; `code:run` on the `code` queue
(a separate worker service) executes it and commits the result with the call's outcome in one transaction, then
enqueues `bot:tick`. Because one-off jobs are never retried, `code:dispatch` (every 30 s) re-enqueues `queued`
runs whose claim is stale — the row is the delivery. Off by default: one service is simpler, and inline is the
reference path every test exercises first.

## Decisions

| Question | Decision |
|---|---|
| Tool name | `run_code`, for every bot |
| Continuation signing key | HKDF from `SECRETS_ENCRYPTION_KEY`; no new secret |
| Crash safety | Effect ledger: re-run when no unsafe effect started, otherwise outcome unknown with the list |
| Default capture path | `scratch/conversations/<id>/mcp/…`, swept by retention |
| Form elicitation inside a program | Cancelled immediately; use `mcp_exec` |
| Console output | Discarded |
| Process-wide cap | 4 concurrent runs per worker, 5 s slot wait, then `sandbox_busy` |
| `code` queue | Optional, off by default |

## Steps

### 1. Schema — `backend/schema/{code_runs,code_run_effects}.ts`

`code_runs`:

| Column | Notes |
|---|---|
| `projectId`, `botId`, `conversationId` | cascade |
| `toolCallId` | → `tool_calls.id`, cascade, unique — the `run_code` call |
| `status` | `queued` \| `running` \| `interrupted` \| `completed` \| `failed` \| `abandoned` |
| `sourceSha` | the source lives on the call's arguments; this verifies it on resume |
| `options` | `jsonb` — `output_logical_path`, `change_note`, `max_input_bytes` |
| `continuationCiphertext`, `continuationIv`, `continuationAuthTag` | nullable; nulled at any terminal status |
| `continuationBytes`, `approvalRound`, `claimedAt` | |
| `createdAt`, `updatedAt`, `finishedAt` | |

`code_run_effects`: `projectId`, `codeRunId` (cascade), `seq`, `kind` (`mcp_exec` \| `mcp_capture`),
`mcpServerId`, `toolName`, `status` (`started` \| `succeeded` \| `failed`), `startedAt`, `finishedAt`; unique
`(codeRunId, seq)`. `approvals` gains `codeRunId` (nullable, cascade) and `interruptionId`, unique together;
phase 10's partial unique index on `(toolCallId, kind)` is narrowed to `codeRunId IS NULL`, since one program call
may hold a whole batch of pending approvals.

### 2. Config — `backend/config/codeMode.ts`

The limits table, `maxConcurrentRuns` (4), `slotWaitMs` (5000), `maxApprovalRounds` (16), `queue` (`inline` \|
`code`). A test-only override shortens the timeout so the suite need not wait 30 seconds per loop.

### 3. Ops — `backend/ops/CodeRunOps.ts`, `backend/bots/code/{host-memory,host-mcp,primer,errors}.ts`

- `CodeRunOps` — `runner()` (process singleton), `invoke(ctx, input)`, `persistInterrupted(tx, …)`,
  `resume(codeRunId)`, `recoverAfterCrash(toolCallId)` (the ledger decision), `classifyRunError(err)`.
- `host-memory` / `host-mcp` — the host functions, each registered with signature, contract, and bounds; the
  MCP side calls `McpPolicyOps.evaluate` and `McpClientOps.callTool` and nothing else.
- `primer` — `buildPrimer(registry)` and `signatureFor(tool)`.

### 4. Actions — `backend/actions/code-run/*.ts`

| Action | Route | RBAC | Audited | MCP |
|---|---|---|---|---|
| `code-run:view` | `GET /code-run` | member who can read the bot | — | yes |
| `code-run:list` | `GET /code-runs` (`botId`, `status`, paginated) | same | — | yes |

Both serialize status, options, rounds, and the effect ledger — never the continuation. Approvals for programs are
decided through phase 10's `approval:approve` / `:deny`.

### 5. Clocks / tasks — `backend/actions/code/{code-run,code-dispatch}.ts`

`code:run` (queue `code`, frequency 0) and `code:dispatch` (30 s, `orchestrator`), both task-only and registered
only when `queue` is `code`. The worker's queue order gains `code` after `bots` when enabled.

### 6. Bot tools — `backend/bots/tools/run-code.ts`

`run_code` — `[[ bash equivalent command: bun -e '<source>' ]]`, replay `unsafe` with ledger recovery; inputs
`source` (`"?"` for the primer), `output_logical_path?`, `change_note?`, `max_input_bytes?`. Success is inline
(`result`, `result_type`, `result_count`) or stored (`logical_path`, `version_id`, `bytes_written`, `preview`).

### 7. Frontend — `frontend/src/components/chat/RunCodeCall.tsx`, phase 10's `ApprovalCard`

The transcript renders a `run_code` call as highlighted source, the result or stored-file link, the effect ledger,
and approval rounds. The approval card gains a "from a program" variant showing the source with the gated call's
arguments.

### 8. CLI — `cli/src/commands/code.ts`

`botholomew code list [--bot <slug>] [--status] [-l] [-o]` and `botholomew code view <id>` wrap the two actions.
`botholomew approval view <id>` (phase 10) prints the program source for program approvals.

### 9. User docs — `frontend/src/content/docs/code-mode.md`

What a program can and cannot touch, the host API (generated from the same registry as the primer), limits, how
approvals pause and resume a program, and why no credential can reach it. Update `approvals.md` and `security.md`.

### 10. Tests — `backend/__tests__/code/*.test.ts`

- `run-code.test.ts` — TypeScript syntax, top-level `await` / `return`, joins and aggregation, `Promise.all`,
  `output_logical_path`, `?` returns the primer without starting a sandbox.
- `sandbox-escape.test.ts` — `process`, `Bun`, `fetch`, `require`, `import()`, `eval`, `Function`,
  `WebAssembly`, `setTimeout` are absent or inert; `__proto__` keys in host results do not pollute; no host
  return contains the fake authorization server's token (searched by value).
- `limits.test.ts` — infinite loop → `sandbox_timeout`; heap bomb, deep recursion, 257 bridge calls, a 2 MiB
  result, and 300 KiB of source each fail with their mapped type; a fifth concurrent run gets `sandbox_busy`.
- `memory-host.test.ts` — writes to `bots/<other>/…`, to a prompt without `agent-modification`, and to `skills/`
  with the setting off are `write_refused`; versions are authored by the bot; bounds and not-found paths.
- `mcp-capture.test.ts` — capture of a `structuredContent` tool stores the payload, not an envelope, and
  `readJson` round-trips it; a 5 MB capture never crosses the bridge (bridge bytes asserted small).
- `approval-resume.test.ts` — the fake server receives **no** request before approval; approve → exactly one
  request with byte-identical arguments; settled reads are not repeated on resume; a batch of three parks until
  all three are decided; a denial is catchable; round 17 fails; the stored ciphertext contains no plaintext from a
  marker the fake tool returned; a continuation moved to another conversation is refused; `Math.random` arguments
  → `replay_diverged` with nothing executed.
- `crash-recovery.test.ts` — abort after an unsafe effect started → outcome unknown naming it; abort before any
  unsafe effect → the program re-runs and succeeds.
- `primer.test.ts` — every registered host function appears in the primer and in the user doc's API table.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

End to end, with phase 10's real server connected and allowlisted for the leader:

1. Ask the leader for open issues from the last 30 days grouped by label. It writes one `run_code` program that
   captures the list and returns counts. The transcript shows the source and a small object; the captured file
   sits under the conversation's scratch path.
2. Ask it to label the three oldest issues `stale`. The program interrupts; one card per call appears, showing the
   source and each call's arguments.
3. Approve two, deny one. The program resumes, applies two labels, catches the denial, and reports it. The
   provider shows exactly two labels.
4. `botholomew code view <id>` shows two rounds and the ledger, and no continuation.

Then the edge cases:

- A `while (true) {}` program returns `sandbox_timeout`; the bot rewrites it rather than retrying verbatim.
- `await fetch("https://example.com")` fails as a missing global, and the hint says there is no network.
- Kill the worker while a gated program is parked; after restart, approving still resumes it.
- Kill the worker mid-program after an unsafe call started; the bot receives outcome unknown and checks first.
- A program writing `bots/<another-bot>/notes/x.md` gets `write_refused` with the rule in the hint.

## Definition of done

- [ ] `run_code` on one runner per worker, with v1's limits as policy and a process-wide cap
- [ ] `memory.*` under the bot's write rules, with no URL fetch; `mcp.*` through phase 10's policy and client
- [ ] Interrupt before the effect; batches resolved together; denial catchable; round cap
- [ ] Continuations HKDF-signed, context-bound, AES-GCM encrypted in `code_runs`, nulled at terminal states
- [ ] Replay verification failure executes nothing; effect ledger drives crash recovery
- [ ] `mcp.capture` stores payloads, never envelopes; no `membot_pipe`
- [ ] Errors mapped from codes, with the three substring fallbacks isolated and version-pinned
- [ ] Generated primer and `signature` hints; the drift test passes
- [ ] Optional `code` queue with its reconciler
- [ ] Transcript rendering, program approval cards, CLI, and user docs
- [ ] Tests listed above pass twice consecutively

## Commands

```bash
botholomew code list --bot botholomew
botholomew code view 17
botholomew approval list --status pending

# With the code queue enabled (ops CLI, local Postgres)
cd backend && bun keryx.ts code:dispatch
```

## Learnings from the build

Not built yet. This section records what is load-bearing in the shipped phase; today the plan above is the only
account.
