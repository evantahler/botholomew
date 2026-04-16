import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { generateDescription } from "../../src/context/describer.ts";

describe("generateDescription", () => {
  test("returns empty string when no API key is configured", async () => {
    const config = { ...DEFAULT_CONFIG, anthropic_api_key: "" };
    const result = await generateDescription(config, {
      filename: "report.md",
      mimeType: "text/markdown",
      content: "# Quarterly Report\n\nRevenue was up 15%.",
    });
    expect(result).toBe("");
  });

  test("returns empty string for binary files without API key", async () => {
    const config = { ...DEFAULT_CONFIG, anthropic_api_key: "" };
    const result = await generateDescription(config, {
      filename: "photo.png",
      mimeType: "image/png",
      content: null,
    });
    expect(result).toBe("");
  });

  test("returns empty string for binary files with filePath but no API key", async () => {
    const config = { ...DEFAULT_CONFIG, anthropic_api_key: "" };
    const result = await generateDescription(config, {
      filename: "photo.png",
      mimeType: "image/png",
      content: null,
      filePath: "/tmp/photo.png",
    });
    expect(result).toBe("");
  });
});
