import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
  // Create the .botholomew directory
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(projectDir, "config"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("returns defaults when no config file exists", async () => {
    const config = await loadConfig(projectDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("merges partial user config with defaults", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-20250514" }),
    );

    const config = await loadConfig(projectDir);
    expect(config.model).toBe("claude-sonnet-4-20250514");
    // Other fields should be defaults
    expect(config.tick_interval_seconds).toBe(
      DEFAULT_CONFIG.tick_interval_seconds,
    );
    expect(config.max_tick_duration_seconds).toBe(
      DEFAULT_CONFIG.max_tick_duration_seconds,
    );
    expect(config.anthropic_api_key).toBe(DEFAULT_CONFIG.anthropic_api_key);
  });

  test("loads full user config", async () => {
    const userConfig = {
      anthropic_api_key: "sk-test-key",
      model: "claude-sonnet-4-20250514",
      tick_interval_seconds: 60,
      max_tick_duration_seconds: 30,
    };
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify(userConfig),
    );

    const config = await loadConfig(projectDir);
    expect(config.anthropic_api_key).toBe("sk-test-key");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.tick_interval_seconds).toBe(60);
    expect(config.max_tick_duration_seconds).toBe(30);
  });

  test("ANTHROPIC_API_KEY env var overrides config file", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ anthropic_api_key: "from-file" }),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "from-env";

    try {
      const config = await loadConfig(projectDir);
      expect(config.anthropic_api_key).toBe("from-env");
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test("env var override takes precedence even with no config file", async () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "env-only";

    try {
      const config = await loadConfig(projectDir);
      expect(config.anthropic_api_key).toBe("env-only");
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });
});

describe("saveConfig", () => {
  test("saves config to file", async () => {
    await saveConfig(projectDir, { model: "claude-sonnet-4-20250514" });

    const content = await Bun.file(
      join(projectDir, "config", "config.json"),
    ).text();
    const parsed = JSON.parse(content);
    expect(parsed.model).toBe("claude-sonnet-4-20250514");
  });

  test("save then load roundtrip preserves fields", async () => {
    const config = {
      anthropic_api_key: "sk-roundtrip",
      model: "claude-sonnet-4-20250514",
      tick_interval_seconds: 120,
    };
    await saveConfig(projectDir, config);

    // Clear env to avoid override
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const loaded = await loadConfig(projectDir);
      expect(loaded.anthropic_api_key).toBe("sk-roundtrip");
      expect(loaded.model).toBe("claude-sonnet-4-20250514");
      expect(loaded.tick_interval_seconds).toBe(120);
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      }
    }
  });

  test("formats JSON with indentation", async () => {
    await saveConfig(projectDir, { model: "test" });

    const content = await Bun.file(
      join(projectDir, "config", "config.json"),
    ).text();
    // Should be indented (pretty-printed)
    expect(content).toContain("  ");
    // Should end with a newline
    expect(content.endsWith("\n")).toBe(true);
  });
});
