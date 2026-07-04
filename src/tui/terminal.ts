// Full-clear escape sequence: erase screen (2J), erase scrollback (3J), and
// move the cursor home (H). Used to force a clean redraw of the whole terminal
// — Ink's incremental renderer can't un-write <Static> scrollback, so we wipe
// everything and let a <Static> remount re-flush the history at the current
// width. Shared by /clear and the resize redraw.
export const CLEAR_TERMINAL = "\x1b[2J\x1b[3J\x1b[H";

export function clearTerminal(
  stdout: NodeJS.WriteStream = process.stdout,
): void {
  if (stdout.isTTY) stdout.write(CLEAR_TERMINAL);
}
