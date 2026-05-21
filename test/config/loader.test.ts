import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(projectDir, "config"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("returns defaults when no config file exists", async () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const config = await loadConfig(projectDir);
      expect(config).toEqual(DEFAULT_CONFIG);
    } finally {
      if (originalEnv !== undefined)
        process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });

  test("merges partial user llm block with defaults", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ llm: { model: "claude-sonnet-4-20250514" } }),
    );

    const config = await loadConfig(projectDir);
    expect(config.llm.model).toBe("claude-sonnet-4-20250514");
    expect(config.llm.provider).toBe("anthropic");
    expect(config.tick_interval_seconds).toBe(
      DEFAULT_CONFIG.tick_interval_seconds,
    );
  });

  test("loads full user config", async () => {
    const userConfig = {
      llm: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        api_key: "sk-test-key",
      },
      tick_interval_seconds: 60,
      max_tick_duration_seconds: 30,
    };
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify(userConfig),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const config = await loadConfig(projectDir);
      expect(config.llm.api_key).toBe("sk-test-key");
      expect(config.llm.model).toBe("claude-sonnet-4-20250514");
      expect(config.tick_interval_seconds).toBe(60);
      expect(config.max_tick_duration_seconds).toBe(30);
    } finally {
      if (originalEnv !== undefined)
        process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });

  test("ANTHROPIC_API_KEY env var overrides config file for anthropic provider", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ llm: { provider: "anthropic", api_key: "from-file" } }),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "from-env";

    try {
      const config = await loadConfig(projectDir);
      expect(config.llm.api_key).toBe("from-env");
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test("ANTHROPIC_API_KEY does not apply to non-anthropic providers", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        llm: { provider: "ollama", model: "llama3.1:8b" },
      }),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "from-env";

    try {
      const config = await loadConfig(projectDir);
      expect(config.llm.api_key).toBe("");
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test("follows a valid relative symlink", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json.anthropic"),
      JSON.stringify({ llm: { provider: "anthropic", api_key: "sk-linked" } }),
    );
    await symlink(
      "config.json.anthropic",
      join(projectDir, "config", "config.json"),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const config = await loadConfig(projectDir);
      expect(config.llm.api_key).toBe("sk-linked");
    } finally {
      if (originalEnv !== undefined)
        process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });

  test("throws a clear error when config.json is a dangling symlink", async () => {
    await symlink(
      "config.json.anthropic",
      join(projectDir, "config", "config.json"),
    );

    await expect(loadConfig(projectDir)).rejects.toThrow(
      /symlink to a missing target/,
    );
  });

  test("OLLAMA_HOST env var fills in base_url for ollama provider when unset", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ llm: { provider: "ollama", model: "llama3.1:8b" } }),
    );

    const original = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://example:11434";
    try {
      const config = await loadConfig(projectDir);
      expect(config.llm.base_url).toBe("http://example:11434");
    } finally {
      if (original !== undefined) process.env.OLLAMA_HOST = original;
      else delete process.env.OLLAMA_HOST;
    }
  });
});

describe("saveConfig", () => {
  test("saves config to file", async () => {
    await saveConfig(projectDir, {
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    });

    const content = await Bun.file(
      join(projectDir, "config", "config.json"),
    ).text();
    const parsed = JSON.parse(content);
    expect(parsed.llm.model).toBe("claude-sonnet-4-20250514");
  });

  test("save then load roundtrip preserves fields", async () => {
    const cfg = {
      llm: {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-20250514",
        api_key: "sk-roundtrip",
      },
      tick_interval_seconds: 120,
    };
    await saveConfig(projectDir, cfg);

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const loaded = await loadConfig(projectDir);
      expect(loaded.llm.api_key).toBe("sk-roundtrip");
      expect(loaded.llm.model).toBe("claude-sonnet-4-20250514");
      expect(loaded.tick_interval_seconds).toBe(120);
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      }
    }
  });

  test("formats JSON with indentation", async () => {
    await saveConfig(projectDir, { llm: { model: "test" } });

    const content = await Bun.file(
      join(projectDir, "config", "config.json"),
    ).text();
    expect(content).toContain("  ");
    expect(content.endsWith("\n")).toBe(true);
  });
});
