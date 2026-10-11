import { skeletonWidth } from "../utils/skeleton";

/** See {@link SkeletonBlocks}. */
export interface SkeletonBlocksProps {
  /** How many card-shaped blocks to draw. */
  count?: number;
  /** The `data-testid` on the wrapper. */
  testId: string;
  /**
   * What a screen reader hears instead of the bars, which are `aria-hidden`.
   * Name the thing being fetched — "Loading tags" rather than "Loading".
   */
  label?: string;
}

/**
 * Card-shaped ghosts for a list whose first read has not answered yet.
 *
 * Two bars per block rather than a configurable number, because every list in
 * this app is the same shape: a name, and a `.bh-mono-label` slug under it. A
 * knob would let a caller describe a card that does not exist.
 *
 * This is the non-table half of the pair — see {@link SkeletonRows} for why they
 * are two components rather than one with a `variant`.
 * @param props - See {@link SkeletonBlocksProps}.
 * @returns The rendered blocks.
 */
export default function SkeletonBlocks({
  count = 3,
  testId,
  label = "Loading",
}: SkeletonBlocksProps) {
  return (
    <div className="bh-skeleton-blocks" data-testid={testId} role="status">
      {/* One announcement for the whole set; every bar below is `aria-hidden`,
          so what a screen reader hears is a sentence rather than a wall. */}
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, block) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no id.
        <div key={block} className="bh-skeleton-block" aria-hidden="true">
          <span
            className="bh-skeleton"
            style={{ width: skeletonWidth(block, 0) }}
          />
          <span
            className="bh-skeleton"
            style={{ width: skeletonWidth(block, 1) }}
          />
        </div>
      ))}
    </div>
  );
}
