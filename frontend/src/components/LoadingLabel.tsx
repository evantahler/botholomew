/** See {@link LoadingLabel}. */
export interface LoadingLabelProps {
  /**
   * What is being waited on. Defaults to `"Loading"`, deliberately **without**
   * an ellipsis: the blinking caret after the word is the "still working"
   * signal, and a `…` beside it is the same signal twice.
   */
  label?: string;
  /**
   * Centre it in a full-height block, for a wait that owns the whole page or the
   * whole of a column. Off by default, which is the inline case: a line of text
   * inside a card or beside a heading.
   *
   * A prop rather than a second component, because the two differ only in
   * padding and alignment; and a class rather than
   * `className="d-flex justify-content-center py-5"` at the call site, because
   * the second caller wanting a full-page wait would otherwise retype that
   * string slightly differently.
   */
  block?: boolean;
  /**
   * The `data-testid`. **Required, with no default.** Two elements sharing an
   * id is not a cosmetic problem: Playwright's strict mode refuses the locator
   * outright, so the failure is every spec that touches the page rather than
   * one assertion about a label. A default guarantees exactly that collision
   * the second time a page waits on two things.
   */
  testId: string;
}

/**
 * The one thing this app renders while a read is in flight and there is nothing
 * table-shaped to draw ghosts of.
 *
 * It is words rather than an empty spinner, and that is an accessibility
 * property: the `status` role sits on an element with words in it, so a screen
 * reader says "Loading members" rather than nothing.
 *
 * `role="status"` is `aria-live="polite"` plus `aria-atomic="true"` by
 * definition, so there is no separate `aria-live` here and there must not be one
 * — restating an implicit attribute is how the two drift.
 *
 * The caret is the literal `.bh-cursor` class rather than a new one wearing a
 * copy of `bh-blink`, and that is the load-bearing detail. The
 * `prefers-reduced-motion` block at the end of `theme.scss` cancels
 * `.bh-cursor::after` **by name**; a `.bh-loading-caret` with its own
 * `animation` would blink straight through `reduce` and nothing would fail,
 * because that block enumerates rules rather than matching them.
 * @param props - See {@link LoadingLabelProps}.
 * @returns The rendered label.
 */
export default function LoadingLabel({
  label = "Loading",
  block = false,
  testId,
}: LoadingLabelProps) {
  return (
    <p
      className={block ? "bh-loading bh-loading-block" : "bh-loading"}
      role="status"
      data-testid={testId}
    >
      {label}
      {/* Decorative: the word beside it is what gets announced, and a screen
          reader reading "▊" adds nothing. `.bh-cursor` draws the glyph from
          `::after`, so this span is deliberately empty. */}
      <span className="bh-cursor" aria-hidden="true" />
    </p>
  );
}
