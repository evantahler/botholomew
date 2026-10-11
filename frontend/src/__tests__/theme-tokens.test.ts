import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The backend OAuth/MCP theme is written by hand in TypeScript, while the
// product's active look lives in the `[data-bh-theme="slate"]` token block.
// Neither build can import the other, so this suite reads both files as text and
// asserts the backend copy still matches the slate contract.
//
// It is deliberately cheap: no boot, no browser, no compile. Its whole job is to
// fail loudly the moment the two copies drift.

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** Read a repo-root-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** The slate colors currently used by the backend OAuth/MCP theme. */
const SHARED_SLATE_COLORS = {
  ground: "#06070a",
  surface: "#0f131a",
  raise: "#151a23",
  sunken: "#0a0c11",
  border: "#222b39",
  borderStrong: "#344155",
  text: "#c9d3e2",
  heading: "#e9eff8",
  muted: "#758399",
  accent: "#8b7cff",
  accentFg: "#ffffff",
  marker: "#f472b6",
  linkHover: "#b4a9ff",
  warning: "#fbbf24",
  danger: "#fb7185",
};

const SOURCES = {
  "frontend/src/styles/themes/_tokens.scss": readRepoFile(
    "frontend/src/styles/themes/_tokens.scss",
  ),
  "backend/theme/botholomew-theme.ts": readRepoFile(
    "backend/theme/botholomew-theme.ts",
  ),
};

describe("slate token parity", () => {
  for (const [file, source] of Object.entries(SOURCES)) {
    describe(file, () => {
      for (const [name, hex] of Object.entries(SHARED_SLATE_COLORS)) {
        test(`declares ${name} (${hex})`, () => {
          // Case-insensitive: `#33FF66` is the same color, and the point of this
          // test is drift in the palette, not in the typing.
          expect(source.toLowerCase()).toContain(hex);
        });
      }

      test("declares the shared body and mono stacks", () => {
        expect(source).toContain('"Inter", system-ui');
        expect(source).toContain('"JetBrains Mono"');
      });

      test("declares slate radius and line-height values", () => {
        expect(source).toMatch(/(?:0\.)?35rem/);
        expect(source).toMatch(/(?:0\.)?25rem/);
        expect(source).toMatch(/1\.4/);
      });
    });
  }

  test("backend theme exports the slate accent through Keryx tokens", () => {
    const backend = SOURCES["backend/theme/botholomew-theme.ts"];
    expect(backend).toContain("--keryx-color-primary:${ACCENT}");
    expect(backend).toContain("--keryx-color-primary-hover:${LINK_HOVER}");
  });

  test("backend theme does not keep the retired terminal phosphor accent", () => {
    const backend = SOURCES["backend/theme/botholomew-theme.ts"].toLowerCase();
    expect(backend).not.toContain("#33ff66");
  });
});
