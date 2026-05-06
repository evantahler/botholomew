import { Box, Text } from "ink";
import { memo } from "react";

interface ScrollbarProps {
  /** Total number of lines in the document. */
  total: number;
  /** Number of lines currently visible. */
  visible: number;
  /** Scroll offset (top visible line). */
  offset: number;
  /** Height of the scrollbar in rows. */
  height: number;
  /** Whether the parent pane is currently focused — colors the thumb. */
  focused?: boolean;
}

/**
 * Vertical scrollbar rendered as a column of unicode block characters.
 * The thumb's height and position are proportional to how much of the
 * document is visible. Used in detail panes so the user can see at a glance
 * where they are within a long document.
 */
export const Scrollbar = memo(function Scrollbar({
  total,
  visible,
  offset,
  height,
  focused,
}: ScrollbarProps) {
  if (height <= 0 || total <= 0 || total <= visible) {
    // Nothing to scroll — render an empty column to preserve layout.
    return (
      <Box flexDirection="column" width={1} height={height}>
        {Array.from({ length: Math.max(0, height) }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
          <Text key={i} dimColor>
            {" "}
          </Text>
        ))}
      </Box>
    );
  }

  const thumbHeight = Math.max(1, Math.round((visible / total) * height));
  const maxOffset = Math.max(1, total - visible);
  const thumbStart = Math.min(
    height - thumbHeight,
    Math.round((offset / maxOffset) * (height - thumbHeight)),
  );

  const cells: Array<{ thumb: boolean }> = [];
  for (let i = 0; i < height; i++) {
    cells.push({ thumb: i >= thumbStart && i < thumbStart + thumbHeight });
  }

  return (
    <Box flexDirection="column" width={1} height={height}>
      {cells.map((cell, i) =>
        cell.thumb ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
          <Text key={i} color={focused ? "yellow" : "gray"}>
            █
          </Text>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
          <Text key={i} dimColor>
            │
          </Text>
        ),
      )}
    </Box>
  );
});
