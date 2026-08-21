import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addAllowedTool,
  loadConfig,
  saveConfig,
} from "../../src/config/loader.ts";
import { DEFAULT_CONFIG, DEFAULT_LLM } from "../../src/config/schemas.ts";

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

  test("defaults the approvals block for a config predating the gate (gate stays ON)", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ models: { default: { model: "x" } } }),
    );
    const config = await loadConfig(projectDir);
    expect(config.approvals.enabled).toBe(true);
    expect(config.approvals.allowed_tools).toEqual([]);
    expect(config.approvals.auto_allow_read_only).toBe(false);
  });

  test("deep-merges a partial approvals block", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ approvals: { allowed_tools: ["gmail/read"] } }),
    );
    const config = await loadConfig(projectDir);
    expect(config.approvals.enabled).toBe(true);
    expect(config.approvals.allowed_tools).toEqual(["gmail/read"]);
  });

  test("merges a partial user model entry with the LlmBlock defaults", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: { default: { model: "claude-sonnet-4-20250514" } },
      }),
    );

    const config = await loadConfig(projectDir);
    expect(config.models.default?.model).toBe("claude-sonnet-4-20250514");
    expect(config.models.default?.provider).toBe("anthropic");
    expect(config.tick_interval_seconds).toBe(
      DEFAULT_CONFIG.tick_interval_seconds,
    );
  });

  test("addAllowedTool appends to the allowlist, preserving other keys", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ models: { default: { model: "keep-me" } } }),
    );
    await addAllowedTool(projectDir, "gmail/send");
    await addAllowedTool(projectDir, "gmail/send"); // idempotent
    await addAllowedTool(projectDir, "slack/post");

    const config = await loadConfig(projectDir);
    expect(config.models.default?.model).toBe("keep-me");
    expect(config.approvals.allowed_tools).toEqual([
      "gmail/send",
      "slack/post",
    ]);
  });

  test("loads full user config", async () => {
    const userConfig = {
      models: {
        default: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          api_key: "sk-test-key",
        },
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
      expect(config.models.default?.api_key).toBe("sk-test-key");
      expect(config.models.default?.model).toBe("claude-sonnet-4-20250514");
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
      JSON.stringify({
        models: { default: { provider: "anthropic", api_key: "from-file" } },
      }),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "from-env";

    try {
      const config = await loadConfig(projectDir);
      expect(config.models.default?.api_key).toBe("from-env");
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
        models: { default: { provider: "ollama", model: "llama3.1:8b" } },
      }),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "from-env";

    try {
      const config = await loadConfig(projectDir);
      expect(config.models.default?.api_key).toBe("");
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
      JSON.stringify({
        models: { default: { provider: "anthropic", api_key: "sk-linked" } },
      }),
    );
    await symlink(
      "config.json.anthropic",
      join(projectDir, "config", "config.json"),
    );

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const config = await loadConfig(projectDir);
      expect(config.models.default?.api_key).toBe("sk-linked");
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
      JSON.stringify({
        models: { default: { provider: "ollama", model: "llama3.1:8b" } },
      }),
    );

    const original = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://example:11434";
    try {
      const config = await loadConfig(projectDir);
      expect(config.models.default?.base_url).toBe("http://example:11434");
    } finally {
      if (original !== undefined) process.env.OLLAMA_HOST = original;
      else delete process.env.OLLAMA_HOST;
    }
  });

  test("backfills LlmBlock defaults into a partial model entry", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: { default: { provider: "ollama", model: "llama3.1:8b" } },
      }),
    );
    const config = await loadConfig(projectDir);
    const entry = config.models.default;
    expect(entry?.model).toBe("llama3.1:8b");
    expect(entry?.max_input_tokens).toBe(DEFAULT_LLM.max_input_tokens);
    expect(entry?.supports_tools).toBe(DEFAULT_LLM.supports_tools);
  });

  test("a user models block replaces the defaults wholesale", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ models: { solo: { model: "only-one" } } }),
    );
    const config = await loadConfig(projectDir);
    // No phantom `default` / `fast` entries linger from DEFAULT_MODELS.
    expect(Object.keys(config.models)).toEqual(["solo"]);
  });

  test("a single-entry models block becomes both the default and fast model", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ models: { solo: { model: "only-one" } } }),
    );
    const config = await loadConfig(projectDir);
    expect(config.default_model).toBe("solo");
    expect(config.fast_model).toBe("solo");
  });

  test("fast_model falls back to the default when only default is named", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: { big: { model: "a" }, other: { model: "b" } },
        default_model: "big",
      }),
    );
    const config = await loadConfig(projectDir);
    expect(config.fast_model).toBe("big");
  });

  test("several models with no default_model is an error, not a guess", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: { a: { model: "a" }, b: { model: "b" } },
      }),
    );
    await expect(loadConfig(projectDir)).rejects.toThrow(/no "default_model"/);
  });

  test("a dangling default_model throws and lists the real names", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: { real: { model: "a" } },
        default_model: "ghost",
      }),
    );
    await expect(loadConfig(projectDir)).rejects.toThrow(
      /"default_model" is "ghost"/,
    );
  });

  test("an empty models block throws", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ models: {}, default_model: "x" }),
    );
    // An empty map falls back to DEFAULT_MODELS, so the dangling pointer is
    // what's reported — either way it must not load silently.
    await expect(loadConfig(projectDir)).rejects.toThrow();
  });

  test("ANTHROPIC_API_KEY applies to every anthropic entry, not just one", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: {
          default: { provider: "anthropic", model: "a" },
          fast: { provider: "anthropic", model: "b" },
          local: { provider: "ollama", model: "llama3.1:8b" },
        },
      }),
    );
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "from-env";
    try {
      const config = await loadConfig(projectDir);
      expect(config.models.default?.api_key).toBe("from-env");
      expect(config.models.fast?.api_key).toBe("from-env");
      // The ollama entry is untouched — env overrides are per-provider.
      expect(config.models.local?.api_key).toBe("");
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test("a config still using the removed llm key fails loudly", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({ llm: { provider: "anthropic", model: "old" } }),
    );
    await expect(loadConfig(projectDir)).rejects.toThrow(
      /uses the removed "llm" key/,
    );
  });

  test("a config still using the removed chunker_llm key fails loudly", async () => {
    await Bun.write(
      join(projectDir, "config", "config.json"),
      JSON.stringify({
        models: { default: { model: "new" } },
        chunker_llm: { model: "old" },
      }),
    );
    await expect(loadConfig(projectDir)).rejects.toThrow(
      /uses the removed "chunker_llm" key/,
    );
  });
});

describe("saveConfig", () => {
  test("saves config to file", async () => {
    await saveConfig(projectDir, {
      models: {
        default: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      },
    });

    const content = await Bun.file(
      join(projectDir, "config", "config.json"),
    ).text();
    const parsed = JSON.parse(content);
    expect(parsed.models.default.model).toBe("claude-sonnet-4-20250514");
  });

  test("save then load roundtrip preserves fields", async () => {
    const cfg = {
      models: {
        default: {
          provider: "anthropic" as const,
          model: "claude-sonnet-4-20250514",
          api_key: "sk-roundtrip",
        },
      },
      tick_interval_seconds: 120,
    };
    await saveConfig(projectDir, cfg);

    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const loaded = await loadConfig(projectDir);
      expect(loaded.models.default?.api_key).toBe("sk-roundtrip");
      expect(loaded.models.default?.model).toBe("claude-sonnet-4-20250514");
      expect(loaded.tick_interval_seconds).toBe(120);
    } finally {
      if (originalEnv !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      }
    }
  });

  test("formats JSON with indentation", async () => {
    await saveConfig(projectDir, { models: { default: { model: "test" } } });

    const content = await Bun.file(
      join(projectDir, "config", "config.json"),
    ).text();
    expect(content).toContain("  ");
    expect(content.endsWith("\n")).toBe(true);
  });
});
