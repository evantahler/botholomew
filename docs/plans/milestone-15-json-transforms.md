# Milestone 15: JSON Transforms (`membot_query`)

## Context

External MCP tools routinely return large JSON blobs — an inbox dump, a list of
issues, a table export. The agent frequently needs to *reduce* one of these
("bucket these 303 entries by day", "pull just the id and subject of each",
"how many are over $100") rather than read it whole. Until this milestone there
was no way to do that without pulling every byte into the conversation:

- Reading the blob inline burns the context window and the agent does
  arithmetic by hand, entry by entry — slow, expensive, and it often runs out
  of context before finishing.
- `membot_pipe` could park the blob in the store and `read_large_result` could
  page through it, but neither can *aggregate across pages* — and large-result
  pages are split at fixed character boundaries, so an individual page is rarely
  even valid JSON.

The heavyweight answer (GitHub issue #222 / "safe ephemeral `code_exec`") is
full sandboxed Bun/TS behind an OS-level sandbox (`sandbox-exec` / `bwrap`).
That is a large surface and breaks the project's "the agent has no shell"
principle. A "limited bun/ts eval" is *not* a lighter version of it: `new
Function` / `node:vm` are not real sandboxes in Bun (prototype escapes reach
`Bun`, `fetch`, `fs`), so a *safe* eval collapses straight back into #222. The
safety is the heavy part.

For the specific need — reshape/reduce JSON already in the store — a declarative
transform is both lighter and the only lightweight-*and*-safe option.

## Goal

- Add one tool, `membot_query`, that runs a [JSONata](https://jsonata.org)
  expression over a JSON entry stored at a `logical_path`.
- Return the (usually small) result inline, or write it back to a new
  `logical_path` for chaining.
- Keep the standing token cost of the tool near-zero: a terse description with a
  few worked examples, with the full syntax reference disclosed only on demand
  or on error.
- No code execution. A JSONata expression can only read and reshape the document
  it is given — no filesystem, network, or host access.

## What this unblocks

- **Reduce-in-place.** group / filter / pluck / dedup / sort / aggregate over a
  large blob without it ever entering the conversation.
- **`pipe → query → query` chaining.** `membot_pipe` lands a big MCP result at a
  `logical_path`; `membot_query` reduces it; `output_logical_path` writes the
  reduced result back as a new entry that a later `membot_query` can refine
  further.
- **Token-bounded analysis of arbitrarily large data.** The size of the answer,
  not the size of the source, determines what reaches the agent.

## Decisions

1. **JSONata, not jq, not eval.** JSONata is a pure-JS (`jsonata` npm) expression
   language evaluated against its own AST plus a closed set of built-ins — it
   cannot name `Bun`, `fetch`, `process`, or any prototype, so the worst case is
   a wrong/empty result or a thrown error, never host access. It bundles cleanly
   under `bun build --compile` (no native binary, no WASM asset). jq's power only
   ships via a native binary (violates "no shell") or a heavy WASM blob
   (deployment-unfriendly). It covers every verb in the ask.
2. **`logical_path` is the only source.** Reading from a large-result `lr_N` is
   excluded by design: large-result pages are split at fixed character
   boundaries, so a page is almost never valid JSON. Requiring a membot
   `logical_path` guarantees a complete document. The MCP→store hop is already
   covered by `membot_pipe`.
3. **Three-tier syntax disclosure.** The tool description (loaded every turn) is
   one sentence plus ~6 example one-liners. The full reference lives in a single
   `JSONATA_PRIMER` constant that is returned only (a) in `next_action_hint` when
   an expression fails to compile or evaluate, or (b) when the agent passes
   `expression: "?"`. The model pays for the reference only when it needs it.
4. **Mirror the `membot_pipe` envelope.** Same write-branch fields
   (`logical_path`, `version_id`, `bytes_written`, `preview`) and the same PAT
   error shape (`error_type` / `message` / `next_action_hint`), so the two tools
   compose with a single mental model.

## Architecture

One new wrapper, `src/tools/membot/query.ts`, registered alongside the other
Botholomew-side membot wrappers in `src/tools/membot/index.ts`.

**Input:** `logical_path` (the JSON source), `expression` (JSONata; `"?"` for
help), optional `output_logical_path` + `change_note` (write the result back
instead of returning it), optional `max_input_bytes` (size guard).

**Output:** either the inline branch (`result`, `result_type`, `result_count`)
or the write branch (`logical_path`, `version_id`, `bytes_written`, `preview`),
over the shared PAT error envelope.

**`execute` flow:**

1. If `expression` is `"?"` or empty → return `JSONATA_PRIMER` without reading or
   evaluating anything.
2. `ctx.withMem(mem => mem.read({ logical_path }))`; membot `isHelpfulError` →
   `source_not_found`.
3. Size guard against `max_input_bytes` → `source_too_large`.
4. `JSON.parse` → on throw `invalid_json`.
5. `jsonata(expression)` (compile error → `invalid_expression`, hint =
   parser message + primer); `evaluate` under a best-effort ~5s timeout
   (`evaluation_error` on throw/overrun, hint includes the primer).
6. If `output_logical_path` set → `mem.write` the JSON-stringified result and
   return the write-branch ack; otherwise return the result inline (the agent
   loop's existing large-results mechanism auto-parks it if it is still big).

## Out of scope

- **Arbitrary bun/ts code execution.** Remains GitHub issue #222 ("safe ephemeral
  `code_exec`"). Not built here, and not a prerequisite.
- **Reading JSON from a large-result `lr_N`.** Excluded — paged splits aren't
  valid JSON. Always go through a membot `logical_path`.
- **A `transform` option on `membot_pipe`** (fetch-and-reduce in one call).
  Possible future fast path; if added, it must delegate to the same JSONata
  engine, not fork it.

## Verification

1. `bun test test/tools/membot/query.test.ts` — group/count, filter,
   write-and-reread (chaining), invalid JSON, bad expression (primer surfaced),
   `"?"` help short-circuit, `source_too_large`, `source_not_found`.
2. `bun run lint` and the full `bun test` suite pass.
3. `bun run build` then smoke-test the compiled binary — confirm `jsonata`
   bundles under `bun build --compile`.
4. End-to-end in `bun run dev chat`: `membot_pipe` a large MCP JSON result to a
   `logical_path`, then `membot_query` it (e.g. group-and-count) and confirm only
   the small reduced result returns to context.
