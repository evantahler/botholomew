import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiRoot,
  DEFAULT_BASE_URL,
  readConfig,
  resolveBaseUrl,
  writeConfig,
} from "../src/config.ts";
import {
  resolveSecretValue,
  UnresolvedSecretError,
} from "../src/interpolate.ts";
import { PALETTE } from "../src/palette.ts";

describe("DEFAULT_BASE_URL", () => {
  test("is the production API origin", () => {
    expect(DEFAULT_BASE_URL).toBe("https://api.botholomew.com");
  });
});

describe("resolveBaseUrl", () => {
  test("highest wins: flag, BOTHOLOMEW_URL, BOTHOLOMEW_BASE_URL, config, default", () => {
    const file = { baseUrl: "http://from-file:9" };
    expect(
      resolveBaseUrl("http://flag:1", file, {
        BOTHOLOMEW_URL: "http://env-url:2",
        BOTHOLOMEW_BASE_URL: "http://env-base:3",
      }),
    ).toBe("http://flag:1");
    expect(
      resolveBaseUrl(undefined, file, {
        BOTHOLOMEW_URL: "http://env-url:2/",
        BOTHOLOMEW_BASE_URL: "http://env-base:3",
      }),
    ).toBe("http://env-url:2");
    expect(
      resolveBaseUrl(undefined, file, {
        BOTHOLOMEW_BASE_URL: "http://env-base:3",
      }),
    ).toBe("http://env-base:3");
    expect(resolveBaseUrl(undefined, file, {})).toBe("http://from-file:9");
    expect(resolveBaseUrl(undefined, {}, {})).toBe(DEFAULT_BASE_URL);
  });
});

describe("apiRoot", () => {
  test("appends /api and strips a trailing slash on the origin", () => {
    expect(apiRoot("https://api.botholomew.com")).toBe(
      "https://api.botholomew.com/api",
    );
    expect(apiRoot("http://localhost:8080/")).toBe("http://localhost:8080/api");
  });
});

describe("writeConfig", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
    delete process.env.XDG_CONFIG_HOME;
  });

  test("creates the file with mode 0600", () => {
    dir = mkdtempSync(join(tmpdir(), "botholomew-cli-"));
    process.env.XDG_CONFIG_HOME = dir;
    writeConfig({ sessionCookie: "secret-cookie", baseUrl: DEFAULT_BASE_URL });
    const path = join(dir, "botholomew", "config.json");
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readConfig().sessionCookie).toBe("secret-cookie");
  });
});

describe("resolveSecretValue", () => {
  test("resolves a whole-value $NAME or ${NAME}", () => {
    const env = { BOTHOLOMEW_PASSWORD: "hunter22" };
    expect(resolveSecretValue("$BOTHOLOMEW_PASSWORD", "--password", env)).toBe(
      "hunter22",
    );
    expect(
      resolveSecretValue("${BOTHOLOMEW_PASSWORD}", "--password", env),
    ).toBe("hunter22");
  });

  test("leaves anything that is not one whole reference as a literal", () => {
    const env = { HOME: "/should-not-appear" };
    expect(resolveSecretValue("$HOME/x", "--password", env)).toBe("$HOME/x");
    expect(resolveSecretValue("pa$$word", "--password", env)).toBe("pa$$word");
    expect(resolveSecretValue("sk-literal", "--password", env)).toBe(
      "sk-literal",
    );
    // Lowercase is not an environment variable name in this convention.
    expect(resolveSecretValue("$home", "--password", env)).toBe("$home");
  });

  test("$$ escapes a literal leading $", () => {
    expect(resolveSecretValue("$$NOT_AN_ENV", "--password", {})).toBe(
      "$NOT_AN_ENV",
    );
  });

  test("a missing or empty variable names the flag and the variable", () => {
    for (const env of [{}, { BOTHOLOMEW_PASSWORD: "" }]) {
      try {
        resolveSecretValue("$BOTHOLOMEW_PASSWORD", "--password", env);
        throw new Error("expected UnresolvedSecretError");
      } catch (error) {
        expect(error).toBeInstanceOf(UnresolvedSecretError);
        const unresolved = error as UnresolvedSecretError;
        expect(unresolved.label).toBe("--password");
        expect(unresolved.envName).toBe("BOTHOLOMEW_PASSWORD");
      }
    }
  });
});

describe("PALETTE", () => {
  test("matches the slate theme tokens the backend theme declares", async () => {
    // The backend's copy of the theme is a `.ts` file of literal hex values,
    // which makes it the stable thing to compare against.
    const theme = await Bun.file(
      join(
        import.meta.dir,
        "..",
        "..",
        "backend",
        "theme",
        "botholomew-theme.ts",
      ),
    ).text();
    for (const hex of Object.values(PALETTE)) {
      expect(theme.toLowerCase()).toContain(hex);
    }
  });
});
