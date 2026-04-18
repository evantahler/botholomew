import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import {
  generateDescription,
  generateDescriptionAndPath,
  sanitizeSuggestedPath,
} from "../../src/context/describer.ts";

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

describe("generateDescriptionAndPath", () => {
  test("returns null when no API key is configured", async () => {
    const config = { ...DEFAULT_CONFIG, anthropic_api_key: "" };
    const result = await generateDescriptionAndPath(config, {
      filename: "report.md",
      mimeType: "text/markdown",
      content: "# Quarterly Report",
      existingTree: "",
    });
    expect(result).toBeNull();
  });
});

describe("sanitizeSuggestedPath", () => {
  test("accepts a simple absolute path", () => {
    expect(sanitizeSuggestedPath("/docs/readme.md")).toBe("/docs/readme.md");
  });

  test("collapses repeated slashes", () => {
    expect(sanitizeSuggestedPath("//docs///sub/file.md")).toBe(
      "/docs/sub/file.md",
    );
  });

  test("strips trailing slashes", () => {
    expect(sanitizeSuggestedPath("/docs/readme.md/")).toBe("/docs/readme.md");
  });

  test("trims whitespace", () => {
    expect(sanitizeSuggestedPath("  /docs/x.md  ")).toBe("/docs/x.md");
  });

  test("rejects relative paths", () => {
    expect(sanitizeSuggestedPath("docs/readme.md")).toBeNull();
  });

  test("rejects parent-traversal", () => {
    expect(sanitizeSuggestedPath("/docs/../etc/passwd")).toBeNull();
  });

  test("rejects empty strings", () => {
    expect(sanitizeSuggestedPath("")).toBeNull();
    expect(sanitizeSuggestedPath("   ")).toBeNull();
  });

  test("rejects root by itself (no filename)", () => {
    expect(sanitizeSuggestedPath("/")).toBeNull();
    expect(sanitizeSuggestedPath("//")).toBeNull();
  });
});
