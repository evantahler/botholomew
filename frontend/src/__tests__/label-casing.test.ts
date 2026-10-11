import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Terminal uppercases button labels with `text-transform`, so a label typed
// `remove` reads as REMOVE and looks deliberate. The other four themes set
// `--bh-label-transform: none` and print the string as typed — and `slate` is the
// default, so a lowercase label is what every reader sees, sitting next to a
// correctly-cased one in the same row.
//
// Nothing about that fails to compile, and no computed-style test can see it: the
// palette is right, the contrast is right, the transform is right. It is the
// *content* that is wrong, which is why this reads the sources as text — and
// why it reads ternaries too: a label written as `? "cancel" : "edit"` does not
// look like a string being displayed, and is the one a pass by eye misses.

const SRC = join(import.meta.dir, "..");

/**
 * Every `.tsx` file under `src`, recursively.
 * @param dir - Directory to walk.
 * @returns Absolute paths.
 */
function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...tsxFiles(path));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The verbs a control is labelled with.
 *
 * A closed list rather than "any lowercase word", because plenty of lowercase
 * strings in this codebase are correct: a tag name (`admin`), an action name
 * (`tag:create`), a CSS keyword (`none`). Those are
 * identifiers being displayed, not sentences being written. What this is looking
 * for is an *action* — the text on a thing you press.
 */
const ACTION_VERBS = [
  "add",
  "apply",
  "cancel",
  "clear",
  "close",
  "copy",
  "create",
  "delete",
  "disable",
  "discard",
  "dismiss",
  "edit",
  "enable",
  "export",
  "import",
  "open",
  "refresh",
  "remove",
  "reset",
  "retry",
  "revoke",
  "rotate",
  "run",
  "save",
  "send",
  "validate",
  "view",
];

const VERBS = ACTION_VERBS.join("|");

/**
 * Report every lowercase action label in one file.
 *
 * Two shapes, because the bug appeared as both. A plain JSX child sits alone on
 * its line between a `>` and a `</`; a conditional label is a string literal
 * inside an expression container, which is the form that survived the first pass.
 * @param source - The file's text.
 * @returns One finding per occurrence, as `line: text`.
 */
function lowercaseLabels(source: string): string[] {
  const lines = source.split("\n");
  const findings: string[] = [];

  const child = new RegExp(`^\\s*(${VERBS})\\s*$`);
  const ternary = new RegExp(
    `\\{[^{}]*\\?\\s*"(${VERBS})"\\s*:\\s*"(${VERBS})"\\s*\\}`,
  );

  lines.forEach((line, index) => {
    // A lone verb on its own line is a JSX text child only if the line before
    // ends an opening tag and the line after closes one. Checking the neighbours
    // keeps a variable named `run` or a bare `open` in a comment out of this.
    if (child.test(line)) {
      const before = lines[index - 1] ?? "";
      const after = lines[index + 1] ?? "";
      if (
        before.trimEnd().endsWith(">") &&
        after.trimStart().startsWith("</")
      ) {
        findings.push(`${index + 1}: ${line.trim()}`);
      }
    }
    if (ternary.test(line)) {
      findings.push(`${index + 1}: ${line.trim()}`);
    }
  });

  return findings;
}

describe("control labels are typed the way they should read", () => {
  test("no JSX renders a lowercase action verb as a label", () => {
    const offenders: Record<string, string[]> = {};

    for (const file of tsxFiles(SRC)) {
      const findings = lowercaseLabels(readFileSync(file, "utf8"));
      if (findings.length > 0) {
        offenders[file.slice(SRC.length + 1)] = findings;
      }
    }

    // The whole map, so one run names every offender rather than the first.
    expect(offenders).toEqual({});
  });

  test("the check actually fires, on both shapes it has to catch", () => {
    // A detector for a content mistake is worth nothing if it silently matches
    // nothing, and the shapes are specific enough that a refactor could stop it
    // matching without any test going red. So it is pointed at both known forms.
    expect(
      lowercaseLabels(
        ["<Button onClick={x}>", "  remove", "</Button>"].join("\n"),
      ),
    ).toEqual(["2: remove"]);

    expect(
      lowercaseLabels('  {editing === row.id ? "cancel" : "edit"}'),
    ).toEqual(['1: {editing === row.id ? "cancel" : "edit"}']);

    // And it leaves the correct spelling alone.
    expect(
      lowercaseLabels(
        ["<Button onClick={x}>", "  Remove", "</Button>"].join("\n"),
      ),
    ).toEqual([]);
  });
});
