/**
 * The ragged widths a skeleton bar cycles through, in `ch`.
 *
 * `ch` rather than `rem` or `%` because there is one typeface everywhere, so a
 * character count is an exact measurement.
 *
 * Seven of them, and the count is load-bearing: see {@link skeletonWidth}.
 */
export const SKELETON_WIDTHS = [10, 16, 7, 13, 9, 20, 12] as const;

/**
 * Pick a bar's width from its position in the grid.
 *
 * Real content is ragged, so a skeleton of identical bars reads as a rendering
 * fault rather than as absent content. What it must **not** be is random:
 * `Math.random()` reshuffles every bar on every re-render — so a skeleton on
 * screen during a refresh flickers, and no screenshot of one is reproducible.
 *
 * The multipliers are why this is a function rather than an index into the
 * array. The obvious `row * columns + column` gives every column the same width
 * all the way down the page whenever the column count divides the cycle length —
 * a seven-column table under a seven-long cycle renders seven perfectly straight
 * stripes — which looks completely deliberate and is invisible until somebody
 * adds a column. Three, five, and seven are pairwise coprime, so no column
 * repeats itself down a table of any width. `__tests__/skeleton.test.ts` asserts
 * exactly that.
 * @param row - The zero-based row index.
 * @param column - The zero-based column index.
 * @returns A CSS length, e.g. `"13ch"`.
 */
export function skeletonWidth(row: number, column: number): string {
  return `${SKELETON_WIDTHS[(row * 3 + column * 5) % SKELETON_WIDTHS.length]}ch`;
}
