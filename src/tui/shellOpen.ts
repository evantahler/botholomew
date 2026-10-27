/**
 * Opening a URL in the browser and copying text to the clipboard from inside
 * the TUI. Shelling out from a TUI component already has precedent in
 * `src/tui/theme.ts` (`defaults read` for the macOS appearance).
 *
 * Everything here spawns with an argv array — never a shell string — so a URL
 * can't be reinterpreted as a command. `isSafeUrl` is a second belt: only
 * http/https reach a spawn.
 */

export interface ShellResult {
  ok: boolean;
  error?: string;
}

/** Only http(s) URLs may be handed to the platform opener. */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Platform command that opens a URL.
 *
 * On Windows this uses `rundll32` rather than `cmd /c start`: `start` re-parses
 * its argument through the shell, where `&` (ubiquitous in OAuth query strings)
 * is a command separator.
 */
export function openCommand(platform: NodeJS.Platform, url: string): string[] {
  if (platform === "darwin") return ["open", url];
  if (platform === "win32")
    return ["rundll32", "url.dll,FileProtocolHandler", url];
  return ["xdg-open", url];
}

/**
 * Candidate clipboard commands for a platform, best first. Linux has no single
 * answer, so callers try each until one is installed.
 */
export function clipboardCommands(platform: NodeJS.Platform): string[][] {
  if (platform === "darwin") return [["pbcopy"]];
  if (platform === "win32") return [["clip"]];
  return [
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
  ];
}

async function run(
  argv: string[],
  stdin?: string,
): Promise<{ code: number; stderr: string }> {
  const [cmd, ...args] = argv;
  if (!cmd) return { code: 1, stderr: "empty command" };
  const proc = Bun.spawn([cmd, ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stderr };
}

/** Open `url` in the user's browser. Never throws. */
export async function openUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ShellResult> {
  if (!isSafeUrl(url)) return { ok: false, error: "not an http(s) URL" };
  const argv = openCommand(platform, url);
  try {
    const { code, stderr } = await run(argv);
    if (code === 0) return { ok: true };
    return { ok: false, error: stderr.trim() || `${argv[0]} exited ${code}` };
  } catch (err) {
    return { ok: false, error: `${argv[0]} not available (${err})` };
  }
}

/** Copy `text` to the system clipboard. Never throws. */
export async function copyToClipboard(
  text: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ShellResult> {
  const candidates = clipboardCommands(platform);
  let lastError = "no clipboard command available";
  for (const argv of candidates) {
    try {
      const { code, stderr } = await run(argv, text);
      if (code === 0) return { ok: true };
      lastError = stderr.trim() || `${argv[0]} exited ${code}`;
    } catch {
      lastError = `install one of: ${candidates.map((c) => c[0]).join(", ")}`;
    }
  }
  return { ok: false, error: lastError };
}
