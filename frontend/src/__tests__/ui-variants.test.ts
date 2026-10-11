import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UI_VARIANT_TONES } from "../ui/core";

// `variantClass` answers every unknown tone with the filled neutral, so a tone
// the stylesheet does not paint does not fail loudly — it paints as a grey pill.
// On a `Button` that reads as a deliberate secondary action, which is why `link`
// was missing for as long as it was: the transcript's expand control looked like
// a button somebody meant, sitting on top of the line it was previewing.
//
// So this compares the *whole set* both ways. A name in the component that the
// stylesheet has no rule for is a silent neutral; a rule with no name behind it
// is a tone nothing can ask for.
const UI_SCSS = readFileSync(
  join(import.meta.dir, "..", "styles", "_ui.scss"),
  "utf8",
);

/**
 * Every tone `_ui.scss` paints, from its generated map and its hand-written
 * rules alike.
 * @param source - The stylesheet's text.
 * @returns The tone names with a fill, a border, or a colour of their own.
 */
function paintedTones(source: string): Set<string> {
  const generated = source
    .slice(source.indexOf("$ui-tones: ("))
    .split(");")[0]
    .matchAll(/"([a-z]+)":\s*"[a-z]+"/g);
  // `outline-x` is the same tone as `x` without the fill, not a tenth name.
  const written = source.matchAll(/\.ui-variant-(?!outline-)([a-z]+)\b/g);
  return new Set(
    [...generated, ...written].map((match) => match[1] as string).sort(),
  );
}

describe("the visual variant contract", () => {
  test("every tone the components can ask for is one the stylesheet paints", () => {
    expect([...paintedTones(UI_SCSS)].sort()).toEqual(
      [...UI_VARIANT_TONES].sort(),
    );
  });

  test("link is a tone with no fill, because it sits over text", () => {
    const rule = UI_SCSS.slice(UI_SCSS.indexOf(".ui-variant-link,")).split(
      "}",
    )[0];
    expect(rule).toContain("background-color: transparent");
    expect(rule).toContain("border-color: transparent");
  });

  test("disabled link actions stay unfilled", () => {
    const rule = UI_SCSS.slice(
      UI_SCSS.indexOf(".ui-button.ui-variant-link:disabled,"),
    ).split("}")[0];
    expect(rule).toContain("background-color: transparent");
    expect(rule).toContain("border-color: transparent");
    expect(rule).toContain("color: var(--bh-disabled-fg)");
  });

  test("secondary actions use a raised surface rather than disabled grey", () => {
    const rule = UI_SCSS.slice(UI_SCSS.indexOf(".ui-variant-secondary,")).split(
      "}",
    )[0];
    expect(rule).toContain("background-color: var(--bh-raise)");
    expect(rule).toContain("color: var(--bh-text)");
    expect(rule).not.toContain("var(--bh-muted)");
  });

  test("the scan reads the generated map and the written rules", () => {
    // An expectation about a set passes just as well when the reader has
    // stopped finding anything at all.
    expect(
      paintedTones(
        [
          '$ui-tones: (\n  "primary": "accent",\n  "danger": "danger",\n);',
          ".ui-variant-link,\n.btn-link {\n  color: inherit;\n}",
        ].join("\n"),
      ),
    ).toEqual(new Set(["primary", "danger", "link"]));
  });
});
