import { logger } from "../utils/logger.ts";
import type { Notification } from "./dispatch.ts";

/** A resolved shell-out, or `null` when the platform has no supported target. */
export interface DesktopCommand {
  cmd: string;
  args: string[];
}

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build the argv for a native desktop notification. Pure (no spawning, no
 * `Bun.which`) so callers pass in `hasTerminalNotifier` and it stays unit-
 * testable across platforms.
 *
 *   - darwin + terminal-notifier → `terminal-notifier -title T -message M`
 *   - darwin (fallback)          → `osascript -e 'display notification "M" with title "T"'`
 *   - linux                      → `notify-send T M`
 *   - anything else              → null (no-op)
 */
export function buildDesktopCommand(
  platform: NodeJS.Platform,
  hasTerminalNotifier: boolean,
  n: Notification,
): DesktopCommand | null {
  if (platform === "darwin") {
    if (hasTerminalNotifier) {
      return {
        cmd: "terminal-notifier",
        args: ["-title", n.title, "-message", n.message],
      };
    }
    const script = `display notification "${escapeAppleScript(
      n.message,
    )}" with title "${escapeAppleScript(n.title)}"`;
    return { cmd: "osascript", args: ["-e", script] };
  }
  if (platform === "linux") {
    return { cmd: "notify-send", args: [n.title, n.message] };
  }
  return null;
}

/**
 * Fire a native desktop notification. Throws on spawn failure / non-zero exit so
 * the dispatcher can record the channel as failed; a missing binary is treated
 * as a soft skip (logged, no throw) since it's an environment gap, not a bug.
 */
export async function sendDesktop(n: Notification): Promise<void> {
  // Never spawn a real OS notification during the test suite — it would pop
  // visible popups on a developer's machine and is non-deterministic across
  // platforms. The argv is unit-tested via `buildDesktopCommand`.
  if (process.env.NODE_ENV === "test") {
    logger.debug(`[test] desktop notification suppressed: "${n.title}".`);
    return;
  }

  const platform = process.platform;
  const hasTerminalNotifier =
    platform === "darwin" && Bun.which("terminal-notifier") != null;
  const command = buildDesktopCommand(platform, hasTerminalNotifier, n);
  if (!command) {
    logger.debug(
      `Desktop notifications not supported on ${platform}; skipping "${n.title}".`,
    );
    return;
  }
  if (Bun.which(command.cmd) == null) {
    logger.debug(
      `\`${command.cmd}\` not found on PATH; skipping desktop notification "${n.title}".`,
    );
    return;
  }

  const proc = Bun.spawn([command.cmd, ...command.args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `${command.cmd} exited ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
    );
  }
}
