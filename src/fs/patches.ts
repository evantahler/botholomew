import { z } from "zod";

export interface LinePatch {
  start_line: number;
  end_line: number;
  content: string;
}

export const LinePatchSchema = z.object({
  start_line: z.number().describe("1-based inclusive start line"),
  end_line: z
    .number()
    .describe("1-based inclusive end line (0 to insert without replacing)"),
  content: z
    .string()
    .describe("Replacement text (empty string to delete lines)"),
});

/**
 * Apply git-style line-range patches to a string. Patches are applied
 * bottom-up so earlier line numbers stay stable. `end_line === 0` is an
 * insert that doesn't replace; an empty `content` deletes.
 */
export function applyLinePatches(raw: string, patches: LinePatch[]): string {
  const lines = raw.split("\n");
  const sorted = [...patches].sort((a, b) => b.start_line - a.start_line);

  for (const patch of sorted) {
    const insertLines = patch.content === "" ? [] : patch.content.split("\n");
    if (patch.end_line === 0) {
      lines.splice(patch.start_line - 1, 0, ...insertLines);
    } else {
      const deleteCount = patch.end_line - patch.start_line + 1;
      lines.splice(patch.start_line - 1, deleteCount, ...insertLines);
    }
  }

  return lines.join("\n");
}
