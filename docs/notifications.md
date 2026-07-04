# Notifications

Workers run in the background and finish tasks while you're away — but a result
that only lands in a [thread CSV](/architecture) never reaches you. The `notify`
capability is a first-class way for a worker (or the chat agent) to **push a
message to you** through channels you already watch.

`notify` is a pure **dispatcher**. It doesn't keep its own inbox — it fans a
message out to the destinations you configure (a desktop popup, Slack, email),
which own their own inboxes. There is no `notify` store on disk and no extra TUI
tab to check.

---

## Channels

Configure one or more channels in the `notify` block of
[`config.json`](/configuration). Every notification is sent to **all** of them.

### Desktop (default)

Zero-config native popups. No `config.json` changes needed — this is the default
channel.

| Platform | Mechanism |
| --- | --- |
| macOS | [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) if installed, else `osascript` (built in) |
| Linux | `notify-send` (from `libnotify`) |
| Windows | not yet supported (no-op) |

If the notifier binary isn't on `PATH`, the channel logs a debug line and skips —
it never fails the task that triggered it.

### mcpx (Slack, email, …)

Deliver through any tool on a configured [mcpx](/mcpx) server. String values in
`args` may contain `{{title}}`, `{{message}}`, and `{{severity}}` placeholders,
substituted per notification.

```json
{
  "notify": {
    "channels": [
      { "type": "desktop" },
      {
        "type": "mcpx",
        "server": "slack",
        "tool": "send_dm_to_user",
        "args": { "user": "me@example.com", "message": "{{title}} — {{message}}" }
      }
    ]
  }
}
```

> **The mcpx channel bypasses the [approval gate](/approvals).** A notify target
> listed in `config.json` is pre-approved by virtue of being config — it does
> **not** create an `approvals/<id>.md` record or pause a worker. (Every dispatch
> is still logged.) This is deliberate: notifications are how the agent reaches
> *you*, so they must never themselves get stuck waiting on you.

---

## Worker auto-hooks

Workers notify you about failures on their own — no LLM involvement. Each event
is individually toggleable under `notify.events`:

| Event | Fires when | Default |
| --- | --- | --- |
| `task_failed` | a task ends in `failed` (prompt-load error, agent loop threw) | on |
| `schedule_errored` | a schedule throws while being evaluated | on |
| `task_quarantined` | a task file is malformed *(reserved — wiring lands in a follow-up)* | on |

Set any to `false` to silence it. Set `notify.enabled` to `false` to disable
notifications entirely.

---

## The agent tool

The agent has a `notify` tool so a task can announce completion or ask for
attention:

```
notify(title: "Weekly report ready", message: "Drafted in the knowledge store at reports/2026-W27.md", severity: "info")
```

`severity` is one of `info` | `warning` | `error`. The tool reports back which
channels delivered, so the agent knows whether the message got through.

---

## CLI

Send a one-off notification to verify your setup:

```bash
botholomew notify "the build is green" --title "CI"
botholomew notify "test" --channel mcpx     # only the mcpx channel(s)
botholomew notify "heads up" --severity warning
```

| Flag | Meaning |
| --- | --- |
| `-t, --title <title>` | notification title (default `Botholomew`) |
| `-s, --severity <sev>` | `info` \| `warning` \| `error` (default `info`) |
| `-c, --channel <type>` | only deliver to channels of this type (`desktop` \| `mcpx`) |

---

## Configuration reference

```json
{
  "notify": {
    "enabled": true,
    "channels": [{ "type": "desktop" }],
    "events": {
      "task_failed": true,
      "task_quarantined": true,
      "schedule_errored": true
    }
  }
}
```

See [Configuration](/configuration#notify) for the full key reference.
