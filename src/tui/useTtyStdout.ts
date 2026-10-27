import { useStdout } from "ink";

/**
 * Ink's `useStdout`, typed as the TTY stream Ink renders to. Ink 8 types the
 * stream as a bare `NodeJS.WritableStream`, which drops `columns` / `rows`;
 * the TUI always renders to a terminal, so those are present at runtime (and
 * every caller still falls back when they are undefined).
 */
export function useTtyStdout(): { stdout: NodeJS.WriteStream } {
  const { stdout } = useStdout();
  return { stdout: stdout as NodeJS.WriteStream };
}
