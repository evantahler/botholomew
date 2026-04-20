# Milestone 6: Daemon Watchdog & Distribution

## Goal

Production readiness: OS-level daemon management, binary compilation, and the polish needed to install and run Botholomew reliably on macOS and Linux.

## What Gets Unblocked

- Botholomew runs automatically on system boot
- The daemon self-heals after crashes
- Single-binary distribution (no Bun/Node required)
- Multiple Botholomew projects can run simultaneously on one machine

---

## Implementation

### 1. OS-Level Watchdog (`src/daemon/watchdog.ts`)

New module for generating and installing platform-specific service configs:

**macOS (launchd):**
- Generate a `.plist` file at `~/Library/LaunchAgents/com.botholomew.<project-hash>.plist`
- Configured to:
  - Run every 60 seconds (`StartInterval`)
  - Execute a health-check script that checks PID file and starts daemon if not running
  - Log to `.botholomew/daemon.log`
  - Set `KeepAlive: false` (we manage the long-running process ourselves; launchd just kicks it)

**Linux (systemd):**
- Generate a `.service` file at `~/.config/systemd/user/botholomew-<project-hash>.service`
- And a `.timer` file for the 1-minute watchdog interval
- `systemctl --user enable` and `systemctl --user start`

**Shared:**
- `generateWatchdogConfig(projectDir, platform)` — returns the config file content
- `installWatchdog(projectDir)` — detect platform, generate config, install
- `uninstallWatchdog(projectDir)` — remove config, stop service

### 2. Health Check Script (`src/daemon/healthcheck.ts`)

Standalone script invoked by the watchdog:
1. Read PID file
2. Check if process is alive
3. If not, start the daemon (same as `botholomew daemon start`)
4. If daemon.log is too large (>10MB), rotate it

### 3. Wire Daemon Install Command (`src/commands/daemon.ts`)

Replace the stub for `daemon install`:
- `botholomew daemon install` — detect platform, install watchdog, confirm
- `botholomew daemon uninstall` — remove watchdog, confirm
- Print status of watchdog (installed/not installed) in `daemon status`

### 4. Multi-Project Management

The watchdog needs to handle multiple Botholomew projects on one machine:
- Each project gets its own launchd/systemd unit, keyed by a hash of the project directory path
- `botholomew daemon list` — new subcommand, lists all registered Botholomew projects on this machine (scan LaunchAgents/systemd user units for botholomew entries)

### 5. ~~Binary Compilation~~ (Dropped)

Binary compilation is not feasible — native dependencies like DuckDB and the embedding libraries cannot be bundled by `bun build --compile`.

### 6. Agent Self-Modification

Ensure the daemon can modify `beliefs.md` and `goals.md` during task execution:

Add daemon tools:
- `update_beliefs` — read current beliefs.md, apply changes, write back (preserving frontmatter)
- `update_goals` — same for goals.md
- Only allowed on files where `agent-modification: true` in frontmatter
- Log as `context_update` interaction

---

## Files Modified

| File | Change |
|------|--------|
| `src/daemon/watchdog.ts` | **New** — platform-specific service config generation + install |
| `src/daemon/healthcheck.ts` | **New** — standalone health check script |
| `src/commands/daemon.ts` | Implement install/uninstall, add list subcommand |
| `src/daemon/llm.ts` | Add update_beliefs, update_goals tools |
| ~~`package.json`~~ | ~~Build script~~ (dropped — native deps can't compile) |

## Tests

- `test/daemon/watchdog.test.ts` — config generation for both platforms (don't actually install)
- `test/daemon/healthcheck.test.ts` — PID check logic, log rotation
- `test/daemon/self-modify.test.ts` — agent modifies beliefs.md, frontmatter preserved

## Verification

1. `botholomew daemon install` — installs launchd plist (macOS) or systemd unit (Linux)
2. Kill the daemon process — watchdog restarts it within 60 seconds
3. `botholomew daemon status` — shows daemon running + watchdog installed
4. `botholomew daemon uninstall` — removes watchdog
5. Daemon modifies beliefs.md during a tick — file updated correctly, frontmatter preserved
6. `botholomew daemon list` — shows all registered projects on this machine

## Status: **Superseded by Milestone 9**

Binary compilation was dropped (native deps like DuckDB can't be bundled).
The OS watchdog install (launchd/systemd, PID file, `daemon install` CLI
subcommand, project registry) was **removed** in
[Milestone 9](milestone-9-worker-agents.md). Users found the install too
heavy and too opaque; it's been replaced by explicit worker spawning
(`botholomew worker run|start`), in-DB worker registration + heartbeats,
and an [automation guide](../automation.md) showing how to wire up cron,
tmux, launchd, or systemd on your own terms.

Agent self-modification tools (`update_beliefs`, `update_goals`) remain
in place.
