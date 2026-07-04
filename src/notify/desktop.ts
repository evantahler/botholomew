import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../utils/logger.ts";
// Embedded so `bun build --compile` bakes the icon into the binary (there's no
// node_modules/src tree at runtime). In dev this resolves to the real file path;
// in the compiled binary it's a `$bunfs` path, which `Bun.file` can still read.
import owlIconSource from "./assets/owl.png" with { type: "file" };
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
 * `Bun.which`) so callers pass in `hasTerminalNotifier` and the resolved icon
 * path, keeping it unit-testable across platforms.
 *
 *   - darwin + terminal-notifier → `terminal-notifier -title T -message M [-appIcon I -contentImage I]`
 *   - darwin (fallback)          → `osascript -e 'display notification "M" with title "T"'` (no custom icon possible)
 *   - linux                      → `notify-send [-i I] T M`
 *   - anything else              → null (no-op)
 *
 * The owl icon is only honored by `terminal-notifier` / `notify-send`; plain
 * `osascript` always shows the sending app's icon, so `iconPath` is ignored
 * there.
 */
export function buildDesktopCommand(
  platform: NodeJS.Platform,
  hasTerminalNotifier: boolean,
  n: Notification,
  iconPath?: string | null,
): DesktopCommand | null {
  if (platform === "darwin") {
    if (hasTerminalNotifier) {
      const icon = iconPath
        ? ["-appIcon", iconPath, "-contentImage", iconPath]
        : [];
      return {
        cmd: "terminal-notifier",
        args: ["-title", n.title, "-message", n.message, ...icon],
      };
    }
    const script = `display notification "${escapeAppleScript(
      n.message,
    )}" with title "${escapeAppleScript(n.title)}"`;
    return { cmd: "osascript", args: ["-e", script] };
  }
  if (platform === "linux") {
    const icon = iconPath ? ["-i", iconPath] : [];
    return { cmd: "notify-send", args: [...icon, n.title, n.message] };
  }
  return null;
}

/**
 * Stage the embedded owl icon into the temp dir and return its path (or `null`
 * on failure — the notification still fires, just without branding). Copying is
 * required for the compiled binary, whose embedded asset lives in `$bunfs` where
 * `terminal-notifier` / `notify-send` can't read it; in dev it's a harmless
 * copy of a real file. Cached after the first successful stage.
 */
let stagedIconPath: string | null | undefined;
async function ensureOwlIcon(): Promise<string | null> {
  if (stagedIconPath !== undefined) return stagedIconPath;
  const dest = join(tmpdir(), "botholomew-owl.png");
  try {
    if (!existsSync(dest)) {
      await Bun.write(dest, await Bun.file(owlIconSource).arrayBuffer());
    }
    stagedIconPath = dest;
  } catch (err) {
    logger.debug(`Could not stage notification icon: ${err}`);
    stagedIconPath = null;
  }
  return stagedIconPath;
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
  // Only terminal-notifier / notify-send honor a custom icon; skip staging for
  // the osascript fallback (which can't show one anyway).
  const wantsIcon = platform === "linux" || hasTerminalNotifier;
  const iconPath = wantsIcon ? await ensureOwlIcon() : null;

  const command = buildDesktopCommand(
    platform,
    hasTerminalNotifier,
    n,
    iconPath,
  );
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
