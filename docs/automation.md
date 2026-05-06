# Automation

Botholomew no longer ships an OS-level watchdog. Earlier versions installed a
`launchd` plist or a `systemd` user service that kept a single daemon alive;
we dropped that because the install was heavy and opaque. Instead, you choose
how and when workers run.

This doc covers the common patterns. None of them are installed for you —
you copy the recipe that matches your needs.

---

## The shape of a scheduled run

`botholomew worker run` (one-shot, default mode) does one thing and exits:

1. Write a worker pidfile to `workers/<id>.json` with PID and heartbeat metadata.
2. Start a heartbeat `setInterval` so other workers know it's alive.
3. Evaluate any due schedules and enqueue their tasks.
4. Claim the next eligible pending task.
5. Run the LLM tool loop until the task is complete / failed / waiting.
6. Mark the worker `stopped` and exit.

If there's no eligible task, the worker exits immediately — safe to run on
a tight cron without overlapping concerns.

Two things make this safe to run concurrently with other workers:

- Task claims are atomic — the worker `open()`s an `O_EXCL` lockfile under
  `tasks/.locks/<id>.lock`; only one worker wins.
- Schedule evaluation is gated by an `O_EXCL` lockfile claim under
  `schedules/.locks/<id>.lock` plus a minimum-interval window, so two workers
  can't enqueue duplicate task batches from the same schedule.

See [architecture.md](architecture.md#multi-worker-safety).

---

## Pattern: cron (recommended)

One line. Put this in `crontab -e`:

```cron
# Every 5 minutes, advance one task in ~/projects/inbox-bot
*/5 * * * * cd ~/projects/inbox-bot && /usr/local/bin/botholomew worker run >> logs/cron.log 2>&1
```

- Fire as often as you like; each fire is one task at most.
- Overlap is fine. If two fires start close together, one will claim the
  task and the other will exit without work.
- Resolve `botholomew` with a full path. cron's `PATH` is minimal; `which
  botholomew` from your shell gives you the right answer.
- Redirect to `logs/cron.log` (or anywhere you like) so you can see
  what happened if a run misbehaves.

### More aggressive variants

If you have a backlog you want drained quickly, spawn background workers
every minute:

```cron
* * * * * cd ~/projects/inbox-bot && botholomew worker start >> logs/cron.log 2>&1
```

Each worker still exits after one task; they just overlap freely. A
crashed worker is reaped within ~60s and its task goes back into the
queue.

---

## Pattern: a single long-running worker

Simplest UX for a workstation that's on most of the day: open a tmux or
screen pane and run a persist worker in it.

```bash
tmux new -s botholomew
botholomew worker run --persist
# Ctrl+B, D to detach
```

It'll tick every `tick_interval_seconds` (default 300) when the queue is
empty and back-to-back while there's work. Ctrl+C to stop cleanly (the
shutdown handler marks the worker `stopped`).

No cron, no watchdog, no systemd — and when you want to upgrade, you stop
the pane and start it again.

---

## Pattern: launchd (macOS, optional)

If you want Botholomew to survive logouts and start on boot without cron
or tmux, a minimal `~/Library/LaunchAgents/com.example.botholomew.plist`
looks like:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.botholomew</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/botholomew</string>
    <string>--dir</string>
    <string>/Users/you/projects/inbox-bot</string>
    <string>worker</string>
    <string>run</string>
  </array>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key>
  <string>/Users/you/projects/inbox-bot/logs/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/projects/inbox-bot/logs/launchd.log</string>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/com.example.botholomew.plist
```

This runs `worker run` every 300s. You own the plist; Botholomew doesn't
touch it. If Botholomew lives in a folder launchd can't read (e.g., under
`~/Desktop` on newer macOS), grant Full Disk Access to whichever program
invokes the binary.

---

## Pattern: systemd user timer (Linux, optional)

Two files in `~/.config/systemd/user/`:

`botholomew-inbox.service`:

```ini
[Unit]
Description=Run one Botholomew worker tick

[Service]
Type=oneshot
WorkingDirectory=/home/you/projects/inbox-bot
ExecStart=/usr/local/bin/botholomew worker run
StandardOutput=append:/home/you/projects/inbox-bot/logs/systemd.log
StandardError=append:/home/you/projects/inbox-bot/logs/systemd.log
```

`botholomew-inbox.timer`:

```ini
[Unit]
Description=Run Botholomew every 5 minutes

[Timer]
OnBootSec=60
OnUnitActiveSec=5min
Unit=botholomew-inbox.service

[Install]
WantedBy=timers.target
```

Enable with:

```bash
systemctl --user daemon-reload
systemctl --user enable --now botholomew-inbox.timer
```

Same concurrency story as cron: each fire is one task at most.

---

## Troubleshooting

- **"Nothing's happening."** `botholomew worker list` shows every worker
  pidfile under `workers/`. Filter with `--status running` to see who's
  alive right now. If you see zero running and a non-empty queue, spawn
  one: `botholomew worker start --persist`.
- **"I see dead workers piling up."** Reaped crashes keep their pidfiles
  on disk as forensic evidence; only clean exits (`status='stopped'`) get
  auto-pruned by the reaper after `worker_stopped_retention_seconds`
  (default 1 hour). If dead pidfiles are bothering you, run
  `botholomew worker reap` — it walks `workers/` and unlinks both stale
  dead workers and stopped pidfiles past the retention window. You can
  also `rm workers/<id>.json` directly. `botholomew worker list --status
  dead` shows the list first.
- **"Cron runs aren't firing."** Check `grep CRON /var/log/syslog`
  (Linux) or `log show --predicate 'process == "cron"'` (macOS). Common
  causes: minimal `PATH`, or a relative path to `botholomew`.
- **"Two workers keep claiming the same task."** They don't — by design.
  The lockfile body holds the worker id and `claimed_at` timestamp, so
  only one worker wins the `O_EXCL` open. If you're seeing duplicate **output**, it's because the task was
  re-run after its worker was reaped — check `worker list --status dead`.
- **"The log is getting huge."** Rotate it yourself (logrotate, newsyslog).
  Botholomew used to do this inside the old watchdog; it no longer does.

---

## Why no built-in watchdog?

Feedback from early users: installing `launchctl`/`systemctl` entries was
heavy, platform-specific, and opaque — and because it was installed per
project, it accumulated in `~/Library/LaunchAgents/` faster than users
expected. Replacing it with "run `worker run` however you already run
things" makes the footprint predictable and the failure modes familiar.
If you do want boot-time survival, the templates above give you what the
old watchdog provided, without the magic.
