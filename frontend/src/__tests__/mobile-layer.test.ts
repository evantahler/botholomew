import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The compact density in `studio.css` is imported *after* `_mobile.scss` and
// restates the same properties at a higher specificity. A phone floor that
// lives only in the Sass layer is therefore silent on the look the product
// ships. This file holds `studio.css` to a closing block that restates those
// floors, so a density tweak cannot delete the override while leaving the
// comment.

const STUDIO = readFileSync(
  join(import.meta.dir, "..", "styles", "studio.css"),
  "utf8",
);

/**
 * The last phone media query in `studio.css`, which is the one that wins.
 * @param source - The stylesheet text.
 * @returns The query and everything after it.
 */
function lastPhoneQuery(source: string): string {
  const marker = "@media (max-width: 767.98px)";
  const index = source.lastIndexOf(marker);
  expect(index).toBeGreaterThan(0);
  return source.slice(index);
}

describe("the shipped midnight density on a phone", () => {
  test("restates the 16px field floor after the compact rules", () => {
    const compact = STUDIO.indexOf('[data-bh-theme="slate"] .form-control');
    const phone = STUDIO.lastIndexOf("@media (max-width: 767.98px)");
    expect(compact).toBeGreaterThan(0);
    expect(phone).toBeGreaterThan(compact);

    const block = lastPhoneQuery(STUDIO);
    expect(block).toContain('html[data-bh-theme="slate"] .form-control');
    expect(block).toContain('html[data-bh-theme="slate"] .ui-form-control');

    // A floor, not a size: the compact ratio still decides how a field relates
    // to the rest of the scale, and 16px is only the minimum below which iOS
    // Safari zooms on focus. Written as a bare length it would be the type
    // scale copied, and the copy is what stops tracking the token.
    const field = block.match(/textarea\.form-control\s*\{([^}]*)\}/);
    if (!field) throw new Error("expected the phone field rule");
    const size = field[1].match(/font-size:\s*([^;]+);/);
    if (!size) throw new Error("expected a font-size on the phone field rule");
    expect(size[1]).toContain("var(--bh-font-size");
    expect(size[1]).toMatch(/max\(.+,\s*1rem\)$/);
  });
});
