import wrapAnsi from "wrap-ansi";

/**
 * Wrap an ANSI-colored body string to a column width and return one entry
 * per visual line. Used by the right-pane detail views in every list/detail
 * panel (Tools, Tasks, Threads, Schedules, Context) so long lines wrap
 * instead of getting truncated by `<Text wrap="truncate-end">`.
 *
 * `wrap-ansi` preserves SGR state across wrap boundaries, so colorized
 * JSON / markdown stays intact.
 */
export function wrapDetailLines(text: string, width: number): string[] {
  if (width <= 0) return text.split("\n");
  return wrapAnsi(text, width, { hard: true, trim: false }).split("\n");
}
