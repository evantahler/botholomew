import { describe, expect, test } from "bun:test";
import { join, relative } from "node:path";

/**
 * The mechanical slice of the rule that docs and comments speak in the present
 * tense.
 *
 * Every doc, comment, and JSDoc block in this repository says what *is*. A word
 * that narrates what is to come, or what came before, is a sentence that goes
 * stale the day the thing it promises ships — or the day the history it tells
 * stops mattering — and nobody rereads it then. History lives in git; intent
 * lives in `docs/plans/`.
 *
 * Most of that is a judgement only a reviewer can make. This is the part a test
 * can: a **closed denylist** of words, matched as whole words, over `AGENTS.md`,
 * `README.md`, `docs/**`, the user docs under `frontend/src/content/docs/`, and
 * every `//` and `/* … *\/` comment in a `.ts` / `.tsx` file under `backend/`,
 * `frontend/src/`, and `cli/src/`. Fenced code blocks and inline code spans
 * are skipped, because quoting a word is not using it — which is how this file
 * and the rule's own statement can name the denylist without tripping it.
 *
 * There is no allowlist. A sentence that trips it is rewritten, even when the
 * word is innocent (`the free will of the user`), because an allowlist is
 * where every exception that should have been a rewrite goes to live.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * The denylist. Word phrases match case-insensitively on word boundaries; the
 * two markers match only in capitals, so "a todo list" in prose is not a hit
 * while a `TODO` left in a comment is.
 */
const DENYLIST: { word: string; pattern: RegExp }[] = [
  ...[
    "will",
    "won't",
    "going to",
    "used to",
    "previously",
    "formerly",
    "originally",
    "no longer",
    "in the future",
    "eventually",
    "for now",
  ].map((word) => ({
    word,
    // Typographic apostrophes count: `won’t` is the same word.
    pattern: new RegExp(
      `(?<![\\w'’-])${word.replace("'", "['’]").replace(/ /g, "\\s+")}(?![\\w'’-])`,
      "i",
    ),
  })),
  { word: "TODO", pattern: /(?<!\w)TODO(?!\w)/ },
  { word: "FIXME", pattern: /(?<!\w)FIXME(?!\w)/ },
];

/** One denylisted word found on one line. */
interface Hit {
  file: string;
  line: number;
  word: string;
}

/**
 * Remove inline code spans from one line of prose, so a quoted word is not a
 * used word. A span opens with a run of backticks and closes with a run of the
 * same length, as in CommonMark.
 * @param text - The line.
 * @returns The line with every code span replaced by a space.
 */
export function stripInlineCode(text: string): string {
  return text.replace(/(`+)[\s\S]*?\1/g, " ");
}

/**
 * Find every denylisted word in a block of prose, skipping fenced code blocks
 * and inline code spans.
 * @param text - Markdown, or the text of a comment.
 * @param file - The repo-relative path, for the report.
 * @param firstLine - The 1-based line number `text` starts on.
 * @returns Every hit, in order.
 */
export function scanProse(text: string, file: string, firstLine = 1): Hit[] {
  const hits: Hit[] = [];
  let fence: string | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    // JSDoc lines carry a leading `*`; a fence inside one still opens with it.
    const bare = raw.replace(/^\s*\*?\s?/, "");
    const fenceMatch = bare.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker[0]!.repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const prose = stripInlineCode(raw);
    for (const { word, pattern } of DENYLIST) {
      if (pattern.test(prose)) hits.push({ file, line: firstLine + i, word });
    }
  }
  return hits;
}

/** A comment extracted from source, with the line it starts on. */
export interface SourceComment {
  text: string;
  line: number;
}

/**
 * Characters after which a `/` begins a regular expression rather than a
 * division. Enough for this codebase's code, which is formatted by Biome.
 */
const REGEX_PRECEDERS = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

/** Keywords after which a `/` begins a regular expression. */
const REGEX_KEYWORDS =
  /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|throw)$/;

/**
 * Extract every `//` and `/* … *\/` comment from TypeScript source, skipping
 * strings, template literals (including `${}` holes), and regular expression
 * literals — a URL in a string or a `//` inside a regex is not a comment.
 * @param source - The file's text.
 * @returns Each comment's text and starting line.
 */
export function extractComments(source: string): SourceComment[] {
  const comments: SourceComment[] = [];
  let line = 1;
  let i = 0;
  let lastSignificant = "";
  let recent = "";
  // A stack of template-literal brace depths, so `}` closing a `${…}` hole
  // returns to the template rather than to code.
  const templateStack: number[] = [];
  let braceDepth = 0;

  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === "\n") line++;
      i++;
    }
  };

  /** Consume a template literal body until its closing backtick or a `${`. */
  const readTemplate = () => {
    while (i < source.length) {
      const c = source[i];
      if (c === "\\") {
        advance(2);
      } else if (c === "`") {
        advance(1);
        return;
      } else if (c === "$" && source[i + 1] === "{") {
        advance(2);
        templateStack.push(braceDepth);
        braceDepth++;
        return;
      } else {
        advance(1);
      }
    }
  };

  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      const start = line;
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      comments.push({ text: source.slice(i + 2, stop), line: start });
      advance(stop - i);
      continue;
    }
    if (c === "/" && next === "*") {
      const start = line;
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end;
      comments.push({ text: source.slice(i + 2, stop), line: start });
      advance(stop + 2 - i);
      continue;
    }
    if (c === '"' || c === "'") {
      advance(1);
      while (i < source.length && source[i] !== c && source[i] !== "\n") {
        advance(source[i] === "\\" ? 2 : 1);
      }
      advance(1);
      lastSignificant = c;
      recent = "";
      continue;
    }
    if (c === "`") {
      advance(1);
      readTemplate();
      lastSignificant = "`";
      recent = "";
      continue;
    }
    if (c === "/") {
      const isRegex =
        REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.test(recent);
      if (isRegex) {
        advance(1);
        let inClass = false;
        while (i < source.length && source[i] !== "\n") {
          const r = source[i];
          if (r === "\\") {
            advance(2);
            continue;
          }
          if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) break;
          advance(1);
        }
        advance(1);
        while (i < source.length && /[a-z]/i.test(source[i]!)) advance(1);
        lastSignificant = "/";
        recent = "";
        continue;
      }
    }
    if (c === "{") braceDepth++;
    if (c === "}") {
      braceDepth--;
      if (
        templateStack.length > 0 &&
        templateStack[templateStack.length - 1] === braceDepth
      ) {
        templateStack.pop();
        advance(1);
        readTemplate();
        lastSignificant = "`";
        recent = "";
        continue;
      }
    }

    if (!/\s/.test(c)) {
      lastSignificant = /[\w$]/.test(c) ? "a" : c;
      recent = /[\w$]/.test(c) ? recent + c : "";
    } else if (recent !== "") {
      // Keep the last word across whitespace, so `return /x/` is seen.
      recent = `${recent.split(/\s/).pop()}`;
      lastSignificant = "a";
    }
    advance(1);
  }
  return comments;
}

/**
 * Every file the rule's mechanical slice covers.
 * @returns Repo-relative paths of markdown docs and TypeScript sources.
 */
async function coveredFiles(): Promise<{ docs: string[]; sources: string[] }> {
  const docs = ["AGENTS.md", "README.md"];
  for (const [dir, pattern] of [
    ["docs", "**/*.md"],
    [join("frontend", "src", "content", "docs"), "**/*.md"],
  ] as const) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: join(REPO_ROOT, dir),
    })) {
      docs.push(join(dir, path));
    }
  }

  const sources: string[] = [];
  for (const dir of ["backend", join("frontend", "src"), join("cli", "src")]) {
    for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan({
      cwd: join(REPO_ROOT, dir),
    })) {
      if (path.split("/").some((p) => p === "node_modules" || p === ".cache")) {
        continue;
      }
      sources.push(join(dir, path));
    }
  }
  return { docs: docs.sort(), sources: sources.sort() };
}

/**
 * Format hits so a failure names the file, the line, and the word.
 * @param hits - The hits to report.
 * @returns One `file:line — word` string per hit.
 */
function report(hits: Hit[]): string[] {
  return hits.map((h) => `${h.file}:${h.line} — "${h.word}"`);
}

describe("present tense", () => {
  test("no doc narrates the future or the past", async () => {
    const { docs } = await coveredFiles();
    // Vacuity guard: a glob that matched nothing would pass by reading nothing.
    expect(docs.length).toBeGreaterThan(25);

    const hits: Hit[] = [];
    for (const doc of docs) {
      hits.push(...scanProse(await Bun.file(join(REPO_ROOT, doc)).text(), doc));
    }
    expect(report(hits)).toEqual([]);
  });

  test("no source comment narrates the future or the past", async () => {
    const { sources } = await coveredFiles();
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((s) => s.startsWith("cli"))).toBe(true);
    expect(sources.some((s) => s.startsWith("frontend"))).toBe(true);

    const hits: Hit[] = [];
    for (const source of sources) {
      const text = await Bun.file(join(REPO_ROOT, source)).text();
      for (const comment of extractComments(text)) {
        hits.push(
          ...scanProse(
            comment.text,
            relative(REPO_ROOT, join(REPO_ROOT, source)),
            comment.line,
          ),
        );
      }
    }
    expect(report(hits)).toEqual([]);
  });
});

describe("the scanner itself", () => {
  test("finds each denylisted word, and only as a whole word", () => {
    const words = DENYLIST.map((d) => d.word);
    for (const word of words) {
      expect(
        scanProse(`It ${word} happen.`, "x").map((h) => h.word),
        word,
      ).toContain(word);
    }
    expect(scanProse("It won’t happen.", "x").map((h) => h.word)).toEqual([
      "won't",
    ]);
    // Whole words: these contain a denylisted word and are not it.
    expect(scanProse("willing, goodwill, refused toward, untodo", "x")).toEqual(
      [],
    );
    // The markers are capitals only.
    expect(scanProse("a todo list", "x")).toEqual([]);
  });

  test("skips inline code spans and fenced blocks", () => {
    expect(scanProse("Say `will` and ``it will`` only.", "x")).toEqual([]);
    expect(scanProse("```ts\n// it will\n```\nfine", "x")).toEqual([]);
    expect(scanProse(" * ```ts\n * // it will\n * ```\n * fine", "x")).toEqual(
      [],
    );
    expect(scanProse("```\nok\n```\nit will", "x")).toEqual([
      { file: "x", line: 4, word: "will" },
    ]);
  });

  test("extracts comments but not strings, templates, or regexes", () => {
    const source = [
      'const url = "https://example.com // will";',
      "const t = `a ${'b' /* inside */} // will`;",
      "const r = /\\/\\/ will/;",
      "const d = 4 / 2; // a real comment",
      "/** A JSDoc",
      " * block. */",
      "return /x\\/y/.test(z); // after a regex",
    ].join("\n");
    expect(extractComments(source).map((c) => [c.line, c.text.trim()])).toEqual(
      [
        [2, "inside"],
        [4, "a real comment"],
        [5, "* A JSDoc\n * block."],
        [7, "after a regex"],
      ],
    );
  });
});
