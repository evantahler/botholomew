# The watchdog

Botholomew's daemon is a long-running `bun` process. Long-running Bun
processes die — they get OOM-killed, the network hiccups during a model
call, you accidentally close the terminal. Without supervision, the
queue silently stops draining.

The watchdog is a thin OS-level supervisor that keeps the daemon alive:

- **macOS**: a `launchd` LaunchAgent (`~/Library/LaunchAgents/`).
- **Linux**: a `systemd --user` service + timer
  (`~/.config/systemd/user/`).

Both fire every 60 seconds. They don't run the daemon directly — they
run `healthcheck.ts`, which is idempotent and cheap.

---

## Installation

```bash
botholomew daemon install
```

This detects the platform, writes a `.plist` (macOS) or `.service` +
`.timer` (Linux), loads/enables it, and registers the project in
`~/.botholomew/projects.json` so `botholomew daemon list` can find it
later.

```bash
botholomew daemon list         # all projects with watchdogs installed (supports --limit / --offset)
botholomew daemon uninstall    # remove the watchdog
```

---

## The health check

`src/daemon/healthcheck.ts` runs every 60 seconds:

1. Read `.botholomew/daemon.pid`.
2. If the PID is alive, exit 0 — nothing to do.
3. If the PID is missing or stale, spawn a fresh detached daemon
   (equivalent to `botholomew daemon start`).
4. If `daemon.log` is larger than `LOG_MAX_BYTES` (10 MB), rotate it.

A separate watchdog log (`.botholomew/watchdog.log`) records every
invocation so you can see exactly when restarts happened.

Every `daemon.log` line is prefixed with a local `HH:MM:SS` timestamp, and
lifecycle phases are rendered as `[[phase-name]]` (e.g. `[[tick-start]]`,
`[[claiming-task]]`, `[[sleeping]]`). To jump straight to phase boundaries:

```
grep '\[\[' .botholomew/daemon.log
```

---

## Why not `KeepAlive: true`?

`launchd` supports `KeepAlive: true`, which would respawn the daemon
instantly on exit. We don't use it because:

- A crash loop from a bad config would burn API credits in seconds.
- Rotating logs and running a health check requires real logic, not a
  plist flag.
- The same pattern needs to work on systemd, which doesn't have an
  exact `KeepAlive` equivalent.

Running `healthcheck.ts` on a 60-second timer gives us uniform, scriptable
supervision across both platforms with a built-in cooldown.

---

## Multi-project machines

Service names embed a sanitized version of the absolute project path, so
multiple Botholomew projects on one machine don't collide:

```
/Users/evan/work       → com.botholomew.users-evan-work          (launchd)
/Users/evan/personal   → com.botholomew.users-evan-personal       (launchd)
/home/evan/side-quest  → botholomew-home-evan-side-quest.service (systemd)
```

See `sanitizePathForServiceName()` in `src/constants.ts`.

`botholomew daemon list` scans `~/.botholomew/projects.json` and reports
which projects have watchdogs installed and which are currently running.

---

## What about Windows?

Not supported. The watchdog assumes POSIX PID semantics and either
`launchd` or `systemd`. If you want to run Botholomew on Windows, use
WSL.

---

## Binary compilation?

It would be nice to ship a single statically-linked binary via `bun
build --compile`. This was explored and dropped — DuckDB's native
extensions (including VSS) can't currently be bundled by `bun build`.
For now, Botholomew is distributed as a TypeScript package that runs on
`bun`.
