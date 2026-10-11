import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compile } from "sass";

// The modern layer is a descendant selector, so it needs `@scope`'s limit to stop
// at a nested `data-bh-theme="terminal"` — see `_engine.scss`'s note. `$bh-modern`
// is spelled `:scope:not(…)` to keep its specificity inside that block, and that
// spelling has a trap: outside an `@scope`, `:scope` matches the **root element**.
// A modern rule written anywhere else therefore still compiles, still applies to
// the whole document, and stops nowhere — an easy mistake for a narrow-viewport
// rule in `_mobile.scss` to make.
//
// No page renders a nested terminal root, which is exactly why it is asserted
// here rather than in a browser: the stylesheet is wrong whether or not a page
// currently shows it, and the first page that nests one should not be the thing
// that finds out.

const STYLESHEET = join(import.meta.dir, "..", "styles", "theme.scss");

/**
 * Rules in the compiled stylesheet that apply *only* to modern themes and are not
 * inside an `@scope`.
 *
 * "Only" is the whole distinction, and it is what makes this checkable. A rule
 * from the `every-theme` mixin lists three branches per selector — bare,
 * `[data-bh-theme]`, and modern — carrying **identical** declarations, so its
 * modern branch reaching into a terminal subtree changes nothing that subtree
 * computes. A rule where every branch is modern is a difference, and a difference
 * that does not stop at a nested terminal root is the bug.
 *
 * Walks the CSS tracking brace depth and the depth each `@scope` opened at, which
 * is all the nesting that matters: an `@scope` may sit inside a media query, and a
 * rule inside it is one level deeper again.
 * @param css - The compiled stylesheet.
 * @returns One entry per offending selector.
 */
function unscopedModernSelectors(css: string): string[] {
  const offenders: string[] = [];
  const scopeDepths: number[] = [];
  let depth = 0;
  let current = "";

  for (const character of css) {
    if (character === "{") {
      const prelude = current.trim();
      if (prelude.startsWith("@scope")) {
        scopeDepths.push(depth);
      } else if (scopeDepths.length === 0 && prelude.includes(":scope")) {
        const branches = prelude.split(",").map((branch) => branch.trim());
        if (branches.every((branch) => branch.includes(":scope"))) {
          offenders.push(prelude);
        }
      }
      depth += 1;
      current = "";
    } else if (character === "}") {
      depth -= 1;
      if (scopeDepths.at(-1) === depth) scopeDepths.pop();
      current = "";
    } else {
      current += character;
    }
  }

  return offenders;
}

describe("the modern layer stays inside its scope", () => {
  test("no compiled rule uses :scope outside an @scope block", () => {
    const css = compile(STYLESHEET, { loadPaths: ["node_modules"] }).css;

    // Named in full, so a failure says which rule escaped rather than how many.
    expect(unscopedModernSelectors(css)).toEqual([]);
  });

  test("the layer is actually in there, and the walker can tell", () => {
    const css = compile(STYLESHEET, { loadPaths: ["node_modules"] }).css;
    // Guards the assertion above against passing because nothing was compiled or
    // because `$bh-modern` was renamed out from under it.
    expect(css).toContain(
      '@scope ([data-bh-theme]) to ([data-bh-theme="terminal"])',
    );
    expect(css.split(":scope").length - 1).toBeGreaterThan(50);

    expect(
      unscopedModernSelectors(":scope:not([x]) h1 { color: red }"),
    ).toEqual([":scope:not([x]) h1"]);
    // The `every-theme` shape: a modern branch beside branches that are not, all
    // setting the same thing, which is why it is allowed out here.
    expect(
      unscopedModernSelectors(
        "h1, [data-bh-theme] h1, :scope h1 { color: red }",
      ),
    ).toEqual([]);
    expect(
      unscopedModernSelectors("@scope (a) to (b) { :scope h1 { color: red } }"),
    ).toEqual([]);
    // A scope nested in a media query, which is how `_mobile.scss` emits its own.
    expect(
      unscopedModernSelectors(
        "@media (x) { @scope (a) to (b) { :scope h1 { color: red } } }",
      ),
    ).toEqual([]);
    // ...and the block closing must not leave the walker thinking it is still open.
    expect(
      unscopedModernSelectors(
        "@scope (a) to (b) { :scope h1 { color: red } } :scope h2 { color: red }",
      ),
    ).toEqual([":scope h2"]);
  });
});
