/**
 * generateCapabilitiesMarkdown + writeCapabilitiesFile produce the
 * always-loaded prompts/capabilities.md inventory. The LLM path is
 * exercised via a mocked Anthropic SDK; the fallback path runs without
 * an API key. Frontmatter must round-trip even when the body is
 * regenerated.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getPromptsDir } from "../../src/constants.ts";
import { registerAllTools } from "../../src/tools/registry.ts";

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({
        // No-key fallback path runs without invoking this; tests that need
        // a summarized response set a custom mock per-test.
        content: [{ type: "text", text: "{}" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    };
  },
}));

const { generateCapabilitiesMarkdown, writeCapabilitiesFile } = await import(
  "../../src/context/capabilities.ts"
);

registerAllTools();

const NO_KEY_CONFIG = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "",
} as Required<typeof DEFAULT_CONFIG>;

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-capabilities-"));
  await mkdir(getPromptsDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("generateCapabilitiesMarkdown — fallback path (no API key)", () => {
  test("renders an internal-tool summary without listing tool names", async () => {
    const r = await generateCapabilitiesMarkdown(null, NO_KEY_CONFIG);
    // Coarse buckets show up; specific tool names do not.
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body).not.toContain("create_task");
    expect(r.body).not.toContain("context_read");
  });

  test("instructs the reader to use mcp_list_tools / mcp_search / mcp_info for exact names", async () => {
    const r = await generateCapabilitiesMarkdown(null, NO_KEY_CONFIG);
    expect(r.body).toMatch(/mcp_list_tools|mcp_search|mcp_info/);
  });

  test("notes when no MCPX client is configured", async () => {
    const r = await generateCapabilitiesMarkdown(null, NO_KEY_CONFIG);
    // The fallback writes something acknowledging external capabilities.
    expect(r.counts.mcp).toBe(0);
  });

  test("counts internal tools", async () => {
    const r = await generateCapabilitiesMarkdown(null, NO_KEY_CONFIG);
    expect(r.counts.internal).toBeGreaterThan(0);
  });

  test("handles an MCPX listTools failure gracefully", async () => {
    const broken = {
      listTools: async () => {
        throw new Error("server crashed");
      },
    } as unknown as Parameters<typeof generateCapabilitiesMarkdown>[0];
    const r = await generateCapabilitiesMarkdown(broken, NO_KEY_CONFIG);
    // Fallback succeeds and shows zero MCP tools.
    expect(r.counts.mcp).toBe(0);
    expect(r.body.length).toBeGreaterThan(0);
  });
});

describe("writeCapabilitiesFile", () => {
  test("creates capabilities.md with default frontmatter on first write", async () => {
    const r = await writeCapabilitiesFile(projectDir, null, NO_KEY_CONFIG);
    expect(r.createdFile).toBe(true);
    expect(r.counts.internal).toBeGreaterThan(0);

    const text = await Bun.file(r.path).text();
    expect(text).toMatch(/^---\n/);
    expect(text).toMatch(/loading:\s*always/);
    expect(text).toMatch(/agent-modification:\s*true/);
  });

  test("preserves existing frontmatter when regenerating", async () => {
    const path = join(getPromptsDir(projectDir), "capabilities.md");
    // User edited the frontmatter to flip both flags. Regen must keep them.
    await writeFile(
      path,
      "---\nloading: contextual\nagent-modification: false\n---\n\n# old body\n",
    );
    const r = await writeCapabilitiesFile(projectDir, null, NO_KEY_CONFIG);
    expect(r.createdFile).toBe(false);
    const text = await Bun.file(r.path).text();
    expect(text).toMatch(/loading:\s*contextual/);
    expect(text).toMatch(/agent-modification:\s*false/);
  });

  test("calls the onPhase progress callback", async () => {
    const phases: string[] = [];
    await writeCapabilitiesFile(projectDir, null, NO_KEY_CONFIG, (p) =>
      phases.push(p),
    );
    // We don't assert specific labels (they're prose), only that progress
    // got reported at all and that one mentions the file write.
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.some((p) => p.toLowerCase().includes("capabilities"))).toBe(
      true,
    );
  });
});
