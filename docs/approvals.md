# Approvals

Botholomew can reach the outside world through [mcpx](/mcpx) — sending email,
posting to Slack, opening pull requests. Those actions are irreversible, so by
default **every mcpx tool call requires human approval** before it runs. You opt
specific tools out with an allowlist, or bypass the gate entirely with
`--unsafe`.

This is a guardrail, not a security boundary. mcpx tool annotations are
untrusted server hints; the gate decides *which* calls to pause, and a human
decides whether they run.

---

## The default: deny everything

Out of the box `approvals.enabled` is `true` and the allowlist is empty, so the
gate pauses **every** `mcp_exec` call. How that pause is resolved depends on who
is running:

- **Chat** (interactive) — an inline prompt appears in the TUI. You approve or
  deny with a keystroke; the agent's tool call blocks until you decide.
- **Workers** (background, non-interactive) — the worker can't ask you, so it
  writes an `approvals/<id>.md` record and **parks the task** in `waiting`
  status. You review it later (CLI or the chat Approvals tab); on a decision the
  task is re-queued and the worker re-runs it.

Botholomew's own tools (the knowledge store, tasks, schedules, prompts, skills)
are **not** gated — only outbound mcpx calls are.

---

## Chat: inline approval

When the agent calls a gated mcpx tool during `botholomew chat`, a prompt
appears above the input bar:

```
⚠ Approve tool call?
gmail/send_email (not-allowlisted)
{"to":"alex@example.com","subject":"Q3 numbers"}
y approve · a always allow this tool · n/Esc deny
```

| Key | Effect |
| --- | --- |
| `y` | Approve this one call |
| `a` | Approve **and** add `<server>/<tool>` to `approvals.allowed_tools` so it never prompts again |
| `n` / `Esc` | Deny — the agent gets a structured error and can try another approach |

While the prompt is up it owns the keyboard; other shortcuts are suspended
(Ctrl+C still quits).

---

## Workers: the approval queue

A background worker can't prompt you, so a gated call becomes a file:

```markdown
---
id: 0193abcd-7c10-7d8a-...
status: pending
server: gmail
tool: send_email
args: '{"to":"alex@example.com"}'
call_key: 9f2c…            # stable hash of server+tool+args
task_id: 0193aa…          # the task that's now parked in `waiting`
thread_id: 0193ab…
worker_id: 0193ac…
reason: not-allowlisted
created_at: 2026-06-07T…
updated_at: 2026-06-07T…
decided_at: null
decided_by: null
---
```

The task moves to `waiting` with a reason referencing the approval id. Nothing
else happens until a human decides.

### Deciding

From the CLI:

```bash
botholomew approval list                 # newest first; -s pending, -l/-o paginate
botholomew approval view <id>
botholomew approval approve <id>          # → re-queues the task
botholomew approval deny <id>             # → re-queues so the agent can recover
```

Or from the chat TUI's **Approvals** tab (`Ctrl+p`; a badge shows the pending
count): select a request and press `a` to approve or `d` to deny.

### What happens on a decision

- **Approve** → the record is marked `approved` and the parked task flips back to
  `pending`. A worker re-claims it; when the agent reaches the same call, the
  recorded approval lets it through (matched by `call_key`) and is consumed.
- **Deny** → the record is marked `denied` and the task is re-queued. On the
  re-run the agent receives a structured "denied by a human reviewer" error and
  is told not to retry — it should try an alternative or `fail_task`.

> **Note:** a top-level `mcp_exec` re-run starts the task from the beginning.
> Any *non-gated* side effects the agent performed before parking (e.g. a
> knowledge-store write) will happen again. Gated calls made from
> `membot_run` are different: the worker stores a signed continuation and
> resumes the exact program after every approval in that batch is decided, so
> completed host calls are not replayed.

When several `membot_run` MCP calls interrupt together, every approval in the
batch must be decided before the task is re-queued. A single `approve` /
`deny` on one item leaves the task parked until the rest of the batch is
decided. Each approval records the sandbox interruption it came from, so the
resumed program consumes its own grant and never another task's.

Continuations are signed with a per-project key at
`approvals/.continuation-secret` (created once, mode `0600`). The signature
provides integrity, not secrecy: it stops a tampered continuation from
replaying, but the token still encodes the program and its host-call results,
so treat the `approvals/` directory as sensitive.

---

## Opting tools in (the allowlist)

Add patterns to `approvals.allowed_tools` in `config/config.json` for tools that
should run **without** approval:

```json
{
  "approvals": {
    "enabled": true,
    "allowed_tools": ["gmail/search", "*/list_*", "github/get_pull_request"],
    "auto_allow_read_only": false
  }
}
```

Pattern forms:

| Pattern | Matches |
| --- | --- |
| `gmail/send_email` | exactly that server + tool |
| `gmail/*` | any tool on `gmail` |
| `*/search` | a tool named `search` on any server |
| `search` | bare token — same as `*/search` |
| `/^list_/` | a `/regex/` (with optional flags) tested against the tool name |

Set `auto_allow_read_only: true` to also skip the gate for tools the server
annotates `readOnlyHint: true`. Annotations are untrusted hints, so this is off
by default — prefer an explicit allowlist.

The chat prompt's **always allow** (`a`) appends `<server>/<tool>` here for you.

---

## Bypassing the gate: `--unsafe`

To run with no approval gate at all (like Claude Code's
`--dangerously-skip-permissions`):

```bash
botholomew chat --unsafe
botholomew worker run --unsafe
botholomew worker start --unsafe       # propagates to the detached process
```

`--unsafe` overrides config for that run only. To disable the gate persistently,
set `approvals.enabled: false` in `config/config.json`. Either way the mcpx
client runs on its zero-overhead path (no schema fetch, no callback).

---

## See also

- [MCPX integration](/mcpx) — how external tools are configured and discovered
- [Tasks & schedules](/tasks-and-schedules) — the `waiting` status and re-queueing
- [Configuration](/configuration) — the full `approvals` config block
- [The TUI](/tui) — the Approvals tab and inline prompt
