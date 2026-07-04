import { useStdout } from "ink";
import { useEffect } from "react";
import { useLatestRef } from "../useLatestRef.ts";

interface ResizeRedrawController {
  /** Feed the current terminal dimensions; schedules a debounced redraw when
   *  a dimension actually changed since the last call. */
  onResize(cols: number, rows: number): void;
  /** Cancel any pending redraw timer. */
  dispose(): void;
}

interface ResizeRedrawOptions {
  debounceMs?: number;
}

/**
 * Test-friendly (no-React) core of {@link useResizeRedraw}: remembers the last
 * seen `{cols, rows}` and, when either changes, schedules a single *trailing*
 * debounced `redraw()`. Rapid resize events (a click-drag) coalesce into one
 * redraw once the drag settles. Mirrors the controller/hook split used by
 * `createDeleteConfirmController`.
 */
export function createResizeRedrawController(
  redraw: () => void,
  { debounceMs = 80 }: ResizeRedrawOptions = {},
): ResizeRedrawController {
  let lastCols: number | null = null;
  let lastRows: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    onResize(cols, rows) {
      // First observation just records the baseline — nothing to redraw yet.
      if (lastCols === null || lastRows === null) {
        lastCols = cols;
        lastRows = rows;
        return;
      }
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        redraw();
      }, debounceMs);
    },
    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Redraw the whole TUI when the terminal is resized. Ink's incremental renderer
 * miscounts wrapped/scrolled lines on resize (leaving stale duplicate frames),
 * and it can't un-write `<Static>` scrollback, so the only reliable fix is to
 * wipe the terminal and re-flush. `redraw` should clear the terminal and bump
 * the `<Static>` epoch key. The debounce guarantees this runs after the size
 * hooks have committed the new layout, so the reflush uses the new dimensions.
 */
export function useResizeRedraw(redraw: () => void): void {
  const { stdout } = useStdout();
  const redrawRef = useLatestRef(redraw);
  useEffect(() => {
    if (!stdout) return;
    const controller = createResizeRedrawController(() => redrawRef.current());
    const onResize = () =>
      controller.onResize(stdout.columns ?? 80, stdout.rows ?? 24);
    // Seed the baseline so the first real resize is detected as a change.
    onResize();
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
      controller.dispose();
    };
  }, [stdout, redrawRef]);
}
