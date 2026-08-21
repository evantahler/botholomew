import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  DEFAULT_MODEL_NAME,
  FAST_MODEL_NAME,
} from "../../src/config/schemas.ts";

describe("DEFAULT_CONFIG", () => {
  test("has all expected fields", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("models");
    expect(DEFAULT_CONFIG).toHaveProperty("default_model");
    expect(DEFAULT_CONFIG).toHaveProperty("fast_model");
    expect(DEFAULT_CONFIG).toHaveProperty("embedding_model");
    expect(DEFAULT_CONFIG).toHaveProperty("embedding_dimension");
    expect(DEFAULT_CONFIG).toHaveProperty("tick_interval_seconds");
    expect(DEFAULT_CONFIG).toHaveProperty("max_tick_duration_seconds");
    expect(DEFAULT_CONFIG).toHaveProperty("system_prompt_override");
    expect(DEFAULT_CONFIG).toHaveProperty("max_turns");
  });

  test("tick_interval_seconds is positive", () => {
    expect(DEFAULT_CONFIG.tick_interval_seconds).toBeGreaterThan(0);
  });

  test("max_tick_duration_seconds is positive", () => {
    expect(DEFAULT_CONFIG.max_tick_duration_seconds).toBeGreaterThan(0);
  });

  test("embedding_dimension is a positive integer", () => {
    expect(DEFAULT_CONFIG.embedding_dimension).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_CONFIG.embedding_dimension)).toBe(true);
  });

  test("model names are non-empty strings", () => {
    for (const entry of Object.values(DEFAULT_CONFIG.models)) {
      expect(entry.model.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_CONFIG.embedding_model.length).toBeGreaterThan(0);
  });

  test("API keys default to empty strings", () => {
    for (const entry of Object.values(DEFAULT_CONFIG.models)) {
      expect(entry.api_key).toBe("");
    }
  });

  test("every seeded model entry uses the anthropic provider", () => {
    for (const entry of Object.values(DEFAULT_CONFIG.models)) {
      expect(entry.provider).toBe("anthropic");
    }
  });

  test("default_model and fast_model name real entries", () => {
    expect(DEFAULT_CONFIG.models[DEFAULT_CONFIG.default_model]).toBeDefined();
    expect(DEFAULT_CONFIG.models[DEFAULT_CONFIG.fast_model]).toBeDefined();
    expect(DEFAULT_CONFIG.default_model).toBe(DEFAULT_MODEL_NAME);
    expect(DEFAULT_CONFIG.fast_model).toBe(FAST_MODEL_NAME);
  });

  test("the fast entry is a different, cheaper model than the default", () => {
    const fast = DEFAULT_CONFIG.models[FAST_MODEL_NAME];
    const main = DEFAULT_CONFIG.models[DEFAULT_MODEL_NAME];
    expect(fast?.model).not.toBe(main?.model);
  });

  test("system_prompt_override defaults to empty string", () => {
    expect(DEFAULT_CONFIG.system_prompt_override).toBe("");
  });

  test("max_turns defaults to 0 (unlimited)", () => {
    expect(DEFAULT_CONFIG.max_turns).toBe(0);
  });

  test("tick_interval is longer than max_tick_duration", () => {
    expect(DEFAULT_CONFIG.tick_interval_seconds).toBeGreaterThan(
      DEFAULT_CONFIG.max_tick_duration_seconds,
    );
  });

  test("membot_scope and mcpx_scope default to global so new projects share ~/.membot and ~/.mcpx", () => {
    expect(DEFAULT_CONFIG.membot_scope).toBe("global");
    expect(DEFAULT_CONFIG.mcpx_scope).toBe("global");
  });
});
