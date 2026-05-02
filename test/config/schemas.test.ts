import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";

describe("DEFAULT_CONFIG", () => {
  test("has all expected fields", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("anthropic_api_key");
    expect(DEFAULT_CONFIG).toHaveProperty("model");
    expect(DEFAULT_CONFIG).toHaveProperty("chunker_model");
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
    expect(DEFAULT_CONFIG.model.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.chunker_model.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.embedding_model.length).toBeGreaterThan(0);
  });

  test("API keys default to empty strings", () => {
    expect(DEFAULT_CONFIG.anthropic_api_key).toBe("");
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
});
