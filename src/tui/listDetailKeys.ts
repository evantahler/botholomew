import type { RefObject } from "react";

/**
 * Standard list+detail keyboard model used by every non-chat panel.
 *
 * Two columns: a list/tree on the left and a detail/preview pane on the
 * right. The right pane has an explicit focus state — visualized by its
 * border (dashed when unfocused, solid yellow when focused) — and the
 * arrow keys mean different things depending on it.
 *
 *   focus = "list"  (default)
 *     ↑ / ↓        Move list selection
 *     →            Move focus into the detail pane
 *     ←            (panel-specific; e.g. Context goes up a directory)
 *
 *   focus = "detail"
 *     ↑ / ↓        Scroll the detail pane (one line)
 *     Shift+↑/↓    Page-scroll the detail pane
 *     g / G        Jump to top / bottom of the detail pane
 *     ←            Return focus to the list
 *
 * Panels can intercept ←/→ via `onLeftArrow` / `onRightArrow` to add their
 * own semantics (Context uses → on a folder to drill in). Returning `true`
 * from those callbacks means "I handled it, don't fall through to the
 * default focus transition".
 *
 * State is read through refs because Ink 7's `useInput` (wrapped in React's
 * `useEffectEvent`) intermittently sees a stale closure on Bun + React 19.2.
 */
export type FocusState = "list" | "detail";

export interface ListDetailKeyOptions {
  focusRef: RefObject<FocusState>;
  setFocus: (next: FocusState) => void;
  itemCountRef: RefObject<number>;
  maxDetailScrollRef: RefObject<number>;
  setSelectedIndex: (updater: (prev: number) => number) => void;
  setDetailScroll: (next: number | ((prev: number) => number)) => void;
  pageScrollLines?: number;
  /** Return true if the panel handled ←; otherwise falls through to default. */
  onLeftArrow?: () => boolean;
  /** Return true if the panel handled →; otherwise falls through to default. */
  onRightArrow?: () => boolean;
}

const DEFAULT_PAGE_SCROLL = 10;

export function handleListDetailKey(
  input: string,
  // biome-ignore lint/suspicious/noExplicitAny: Ink's Key type is not exported
  key: any,
  opts: ListDetailKeyOptions,
): boolean {
  const page = opts.pageScrollLines ?? DEFAULT_PAGE_SCROLL;
  const focus = opts.focusRef.current;

  if (key.rightArrow) {
    if (opts.onRightArrow?.()) return true;
    if (focus === "list") opts.setFocus("detail");
    return true;
  }
  if (key.leftArrow) {
    if (opts.onLeftArrow?.()) return true;
    if (focus === "detail") opts.setFocus("list");
    return true;
  }
  if (key.upArrow) {
    if (focus === "detail") {
      const step = key.shift ? page : 1;
      opts.setDetailScroll((s) => Math.max(0, s - step));
    } else {
      opts.setSelectedIndex((i) => Math.max(0, i - 1));
    }
    return true;
  }
  if (key.downArrow) {
    if (focus === "detail") {
      const step = key.shift ? page : 1;
      opts.setDetailScroll((s) =>
        Math.min(opts.maxDetailScrollRef.current, s + step),
      );
    } else {
      opts.setSelectedIndex((i) =>
        Math.min(opts.itemCountRef.current - 1, i + 1),
      );
    }
    return true;
  }
  // Jump keys only make sense in the detail pane.
  if (focus === "detail") {
    if (input === "g") {
      opts.setDetailScroll(0);
      return true;
    }
    if (input === "G") {
      opts.setDetailScroll(opts.maxDetailScrollRef.current);
      return true;
    }
  }
  return false;
}

/**
 * Visual style for the right pane's border. Panels render the right column
 * inside a `<Box>` with these props so the focus state is obvious at a
 * glance: dashed dim border when the list owns focus, bold yellow border
 * when the detail pane owns it.
 */
const DASHED_BORDER = {
  topLeft: "┌",
  top: "┄",
  topRight: "┐",
  left: "┆",
  bottomLeft: "└",
  bottom: "┄",
  bottomRight: "┘",
  right: "┆",
} as const;

export function detailPaneBorderProps(focus: FocusState) {
  return focus === "detail"
    ? { borderStyle: "bold" as const, borderColor: "yellow" as const }
    : { borderStyle: DASHED_BORDER, borderColor: "gray" as const };
}
