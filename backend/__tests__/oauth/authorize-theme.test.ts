import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api } from "keryx";
import { HOOK_TIMEOUT, serverUrl } from "../setup";

// The theme exists twice — the frontend's active slate token block in
// `frontend/src/styles/themes/_tokens.scss`, and `theme/botholomew-theme.ts` for
// the surfaces Keryx renders server-side. This suite proves the backend copy is
// actually reaching a rendered page: it boots a real server, fetches the OAuth
// authorize page over HTTP, and asserts the active palette and glyph are both
// in the response.
// A `WEB_SERVER_THEME` that is unset, misspelled, or pointing at a moved file
// fails here rather than on the next deploy.

/** The active slate theme tokens this page should inherit. */
const TOKENS = {
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
  marker: "#f472b6",
  linkHover: "#b4a9ff",
  warning: "#fbbf24",
  danger: "#fb7185",
};

let url: string;
let html: string;

beforeAll(async () => {
  await api.start();
  url = serverUrl();

  // A `client_id` nothing has registered is deliberate: `handleAuthorizeGet`
  // renders the page regardless (the POST is what enforces the client), so the
  // theme can be asserted without standing up an OAuth client first.
  const res = await fetch(
    `${url}/oauth/authorize?client_id=theme-test&redirect_uri=${encodeURIComponent(
      "http://localhost:9999/cb",
    )}&response_type=code`,
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  html = await res.text();
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

describe("oauth authorize page — theme", () => {
  test("inlines every active slate token", () => {
    for (const [name, hex] of Object.entries(TOKENS)) {
      if (!html.includes(hex)) {
        throw new Error(`the rendered page is missing ${name} (${hex})`);
      }
    }
  });

  test("overrides Keryx's --keryx-* tokens rather than merely adding ours", () => {
    // Keryx inlines DEFAULT_THEME_CSS first, so its values are still present in
    // the document; ours have to appear too, and after it, or the cascade leaves
    // the framework's blue in place.
    expect(html).toContain(`--keryx-color-primary:${TOKENS.accent}`);
    expect(html).toContain(`--keryx-surface:${TOKENS.surface}`);
    expect(html).toContain("--keryx-radius:0.35rem");
    expect(html).toContain('"Inter", system-ui');

    // Assert the framework's own declaration is present before comparing
    // positions: `indexOf` returns -1 for a miss, which would make the ordering
    // check pass for the wrong reason if Keryx ever restyled its default.
    const theirs = html.indexOf("--keryx-color-primary: #2f5266");
    const ours = html.indexOf(`--keryx-color-primary:${TOKENS.accent}`);
    expect(theirs).toBeGreaterThan(-1);
    expect(ours).toBeGreaterThan(theirs);
  });

  test("uses the slate glow and does not ship terminal scanlines", () => {
    expect(html).toContain("rgba(139,124,255,.055)");
    expect(html).not.toContain("repeating-linear-gradient");
  });

  test("serves our glyph, not Keryx's lion", () => {
    expect(html).toContain('data-glyph="botholomew"');
    // The framework's lion is a 2048x2048 pair of paths; ours is three lines of
    // text on a 48x45 box. If the override stops resolving, this is what
    // notices.
    expect(html).not.toContain('viewBox="0 0 2048 2048"');
    expect(html).toContain('viewBox="0 0 48 45"');
    expect(html).toContain("{o,o}");
  });
});
