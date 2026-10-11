import { skeletonWidth } from "../utils/skeleton";

/** See {@link SkeletonRows}. */
export interface SkeletonRowsProps {
  /**
   * How many columns the table has.
   *
   * **Required, with no default**, for the reason `SectionCard`'s `idPrefix` is:
   * this is the one number that has to agree with the caller's own `<thead>`,
   * and a default renders a ragged ghost under a wider header while looking
   * entirely deliberate. Nothing about the page looks wrong and no spec fails;
   * `tsc` refusing the call is the only thing that catches it.
   */
  columns: number;
  /** How many ghost rows to draw. Five is about a screen of a dense table. */
  rows?: number;
  /**
   * The `data-testid` on the first ghost row — the one row of the set a spec can
   * hang off, and the one carrying the announcement.
   */
  testId: string;
  /**
   * What a screen reader hears instead of the bars, which are `aria-hidden`.
   * Name the thing being fetched: "Loading members" is a better answer to "what
   * is this page doing" than "Loading".
   */
  label?: string;
}

/**
 * Ghost rows for a table whose first read has not answered yet.
 *
 * It emits `<tr>`/`<td>` and nothing else, because a `<tbody>` accepts nothing
 * else — which is also why this is a separate component from
 * {@link SkeletonBlocks} rather than a `variant` prop on one: the difference
 * between the two is which parent element they are legal inside, and that is a
 * fact `tsc` can check only while it is a fact about the type.
 *
 * **The caller's `<Table>` stays mounted and keeps its `data-testid`** — these
 * go inside its `<tbody>`. A header is real content we already have, and the
 * e2e suite asserts tables such as `members-table` visible; a locator that
 * resolves to nothing for the first round trip is one that passes only on
 * auto-retry.
 *
 * The bars are `▒` emitted from CSS `content` and clipped to a width, per the
 * theming rule that box-drawing glyphs never appear in JSX. They do not animate:
 * a shimmer is borrowed from a design language with gloss and shadow, and this
 * one has neither. The liveness cue on a loading page is the single blinking
 * caret a {@link LoadingLabel} draws, not one per cell.
 * @param props - See {@link SkeletonRowsProps}.
 * @returns The ghost rows, ready to drop into a `<tbody>`.
 */
export default function SkeletonRows({
  columns,
  rows = 5,
  testId,
  label = "Loading",
}: SkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr
          // The index is the identity: these rows have no content to key on and
          // the set never reorders — it is replaced wholesale by real rows.
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no id.
          key={row}
          className="bh-skeleton-row"
          // Every row but the first is hidden outright. A screen reader given
          // five rows of empty cells reads five rows of empty cells, which is
          // the wall of blocks this has to avoid; the first row carries one
          // `role="status"` announcement for the whole set instead.
          aria-hidden={row === 0 ? undefined : "true"}
          data-testid={row === 0 ? testId : undefined}
        >
          {Array.from({ length: columns }, (_, column) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no id.
            <td key={column}>
              {row === 0 && column === 0 && (
                <span className="visually-hidden" role="status">
                  {label}
                </span>
              )}
              <span
                className="bh-skeleton"
                aria-hidden="true"
                // A width is not a colour, so an inline style is within the
                // theming rule — which is that no JSX hardcodes a colour. The
                // shade, the glyph, and the clipping all live in `theme.scss`.
                style={{ width: skeletonWidth(row, column) }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
