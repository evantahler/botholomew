import { describe, expect, test } from "bun:test";
import {
  listModelNames,
  resolveFastModel,
  resolveModel,
  resolveModelFor,
} from "../../src/config/models.ts";
import type { BotholomewConfig, LlmBlock } from "../../src/config/schemas.ts";
import { DEFAULT_CONFIG, DEFAULT_LLM } from "../../src/config/schemas.ts";

function block(overrides: Partial<LlmBlock> = {}): LlmBlock {
  return { ...DEFAULT_LLM, ...overrides };
}

/** A three-entry registry: default (opus), fast (haiku), local (ollama). */
function configWith(
  overrides: Partial<BotholomewConfig> = {},
): BotholomewConfig {
  return {
    ...DEFAULT_CONFIG,
    models: {
      default: block({ model: "claude-opus-4-6" }),
      fast: block({ model: "claude-haiku-4-5-20251001" }),
      local: block({ provider: "ollama", model: "llama3.1:8b" }),
    },
    default_model: "default",
    fast_model: "fast",
    ...overrides,
  };
}

describe("listModelNames", () => {
  test("returns every configured name, sorted", () => {
    expect(listModelNames(configWith())).toEqual(["default", "fast", "local"]);
  });
});

describe("resolveModel", () => {
  test("falls back to default_model when no name is given", () => {
    const resolved = resolveModel(configWith());
    expect(resolved.name).toBe("default");
    expect(resolved.llm.model).toBe("claude-opus-4-6");
  });

  test("resolves a named entry", () => {
    const resolved = resolveModel(configWith(), "local");
    expect(resolved.name).toBe("local");
    expect(resolved.llm.provider).toBe("ollama");
  });

  test("treats an empty / whitespace name as omitted", () => {
    expect(resolveModel(configWith(), "").name).toBe("default");
    expect(resolveModel(configWith(), "   ").name).toBe("default");
    expect(resolveModel(configWith(), null).name).toBe("default");
  });

  test("trims surrounding whitespace on a real name", () => {
    expect(resolveModel(configWith(), "  local  ").name).toBe("local");
  });

  test("an unknown name throws and lists every configured name", () => {
    // The listing is the recovery path — an agent or user retries from it.
    expect(() => resolveModel(configWith(), "nope")).toThrow(
      /No model named "nope"/,
    );
    expect(() => resolveModel(configWith(), "nope")).toThrow(
      /default, fast, local/,
    );
  });

  test("a dangling default_model names the offending pointer", () => {
    const config = configWith({ default_model: "ghost" });
    expect(() => resolveModel(config)).toThrow(/No model named "ghost"/);
    expect(() => resolveModel(config)).toThrow(/default_model/);
  });
});

describe("resolveFastModel", () => {
  test("resolves fast_model", () => {
    const resolved = resolveFastModel(configWith());
    expect(resolved.name).toBe("fast");
    expect(resolved.llm.model).toBe("claude-haiku-4-5-20251001");
  });

  test("a dangling fast_model names the offending pointer", () => {
    const config = configWith({ fast_model: "ghost" });
    expect(() => resolveFastModel(config)).toThrow(/fast_model/);
  });
});

describe("resolveModelFor precedence", () => {
  const config = configWith();

  test("neither override nor pin falls through to default_model", () => {
    const r = resolveModelFor(config, {});
    expect(r.name).toBe("default");
    expect(r.shadowed).toBeUndefined();
  });

  test("a pin wins over default_model when there is no override", () => {
    const r = resolveModelFor(config, { pinned: "local" });
    expect(r.name).toBe("local");
    expect(r.shadowed).toBeUndefined();
  });

  test("an override wins over a pin, and reports what it displaced", () => {
    const r = resolveModelFor(config, { override: "fast", pinned: "local" });
    expect(r.name).toBe("fast");
    expect(r.shadowed).toBe("local");
  });

  test("an override matching the pin is not reported as shadowing", () => {
    const r = resolveModelFor(config, { override: "local", pinned: "local" });
    expect(r.name).toBe("local");
    expect(r.shadowed).toBeUndefined();
  });

  test("an override with no pin shadows nothing", () => {
    const r = resolveModelFor(config, { override: "local", pinned: null });
    expect(r.name).toBe("local");
    expect(r.shadowed).toBeUndefined();
  });

  test("an unknown override throws rather than silently using the pin", () => {
    expect(() =>
      resolveModelFor(config, { override: "nope", pinned: "local" }),
    ).toThrow(/No model named "nope"/);
  });

  test("an unknown pin throws rather than silently using the default", () => {
    expect(() => resolveModelFor(config, { pinned: "nope" })).toThrow(
      /No model named "nope"/,
    );
  });
});
