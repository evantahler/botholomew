import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { api } from "../../api";

beforeAll(async () => {
  await api.start();
});

afterAll(async () => {
  await api.stop();
});

describe("openai initializer - agent models", () => {
  test("should initialize with available models", () => {
    expect(api.openai).toBeDefined();
    expect(api.openai.availableModels).toBeDefined();
    expect(Array.isArray(api.openai.availableModels)).toBe(true);
    expect(api.openai.availableModels.length).toBeGreaterThan(0);
    
    // Check that each model has the expected structure
    api.openai.availableModels.forEach((model) => {
      expect(model).toHaveProperty("value");
      expect(model).toHaveProperty("label");
      expect(typeof model.value).toBe("string");
      expect(typeof model.label).toBe("string");
    });

    // Check that expected models are included
    const modelValues = api.openai.availableModels.map((m) => m.value);
    expect(modelValues).toContain("gpt-4o");
    expect(modelValues).toContain("gpt-3.5-turbo");
  });

  test("should provide getAvailableModels function", () => {
    expect(api.openai.getAvailableModels).toBeDefined();
    expect(typeof api.openai.getAvailableModels).toBe("function");
    
    const models = api.openai.getAvailableModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models).toEqual(api.openai.availableModels);
  });
});
