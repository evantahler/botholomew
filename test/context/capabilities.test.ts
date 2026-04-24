import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpxClient } from "@evantahler/mcpx";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import {
  generateCapabilitiesMarkdown,
  writeCapabilitiesFile,
} from "../../src/context/capabilities.ts";
import { registerAllTools } from "../../src/tools/registry.ts";
import { parseContextFile } from "../../src/utils/frontmatter.ts";

/** Config with no API key → always takes the fallback path. */
const FALLBACK_CONFIG = { ...DEFAULT_CONFIG, anthropic_api_key: "" };

function mockClient(
  tools: Array<{ server: string; name: string; description: string }>,
): McpxClient {
  return {
    listTools: mock(async () =>
      tools.map((t) => ({
        server: t.server,
        tool: { name: t.name, description: t.description },
      })),
    ),
  } as unknown as McpxClient;
}

let tempDir: string;

beforeEach(() => {
  registerAllTools();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("generateCapabilitiesMarkdown (fallback path)", () => {
  test("renders high-level internal summary without listing tool names", async () => {
    const fixed = new Date("2026-01-02T03:04:05Z");
    const { body, counts } = await generateCapabilitiesMarkdown(
      null,
      FALLBACK_CONFIG,
      fixed,
    );

    expect(body).toContain("# Capabilities");
    expect(body).toContain("*Generated 2026-01-02T03:04:05.000Z");
    expect(body).toContain("## Internal capabilities");
    expect(body).toContain("Task management");
    expect(body).toContain("Virtual filesystem");
    // Tool names are intentionally absent from the rendered body.
    expect(body).not.toContain("`complete_task`");
    expect(body).not.toContain("`context_read`");
    expect(counts.internal).toBeGreaterThan(10);
    expect(counts.mcp).toBe(0);
  });

  test("instructs the reader to use mcp_list_tools / mcp_search / mcp_info", async () => {
    const { body } = await generateCapabilitiesMarkdown(null, FALLBACK_CONFIG);
    expect(body).toContain("mcp_list_tools");
    expect(body).toContain("mcp_search");
  });

  test("renders MCPX section as a server list with tool counts", async () => {
    const client = mockClient([
      { server: "slack", name: "post_message", description: "Post a message." },
      {
        server: "gmail",
        name: "send_email",
        description: "Send an email via Gmail.",
      },
      { server: "gmail", name: "list_inbox", description: "List inbox." },
    ]);

    const { body, counts } = await generateCapabilitiesMarkdown(
      client,
      FALLBACK_CONFIG,
    );
    expect(counts.mcp).toBe(3);
    expect(body).toContain("## External capabilities (via MCPX)");
    expect(body).toContain("**gmail** — 2 tool(s)");
    expect(body).toContain("**slack** — 1 tool(s)");
    // Still no specific tool names rendered in fallback mode.
    expect(body).not.toContain("`send_email`");
    expect(body).not.toContain("`post_message`");
  });

  test("emits a helpful message when no MCPX client is configured", async () => {
    const { body, counts } = await generateCapabilitiesMarkdown(
      null,
      FALLBACK_CONFIG,
    );
    expect(body).toContain("No MCPX servers configured");
    expect(counts.mcp).toBe(0);
  });

  test("notes when MCPX is configured but exposes zero tools", async () => {
    const { body, counts } = await generateCapabilitiesMarkdown(
      mockClient([]),
      FALLBACK_CONFIG,
    );
    expect(body).toContain("MCPX is configured but no tools");
    expect(counts.mcp).toBe(0);
  });

  test("handles an MCPX listTools failure gracefully", async () => {
    const client = {
      listTools: mock(async () => {
        throw new Error("connection refused");
      }),
    } as unknown as McpxClient;

    const { body, counts } = await generateCapabilitiesMarkdown(
      client,
      FALLBACK_CONFIG,
    );
    expect(body).toContain("Failed to list MCPX tools");
    expect(body).toContain("connection refused");
    expect(counts.mcp).toBe(0);
  });
});

describe("writeCapabilitiesFile", () => {
  async function makeProject(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "both-caps-"));
    await mkdir(join(tempDir, ".botholomew"), { recursive: true });
    return tempDir;
  }

  test("creates the file with default frontmatter on first write", async () => {
    const dir = await makeProject();
    const result = await writeCapabilitiesFile(dir, null, FALLBACK_CONFIG);

    expect(result.createdFile).toBe(true);
    expect(result.path).toBe(join(dir, ".botholomew", "capabilities.md"));
    expect(result.counts.internal).toBeGreaterThan(10);

    const raw = await Bun.file(result.path).text();
    const { meta, content } = parseContextFile(raw);
    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(true);
    expect(content).toContain("# Capabilities");
  });

  test("preserves existing frontmatter on regeneration", async () => {
    const dir = await makeProject();
    const filePath = join(dir, ".botholomew", "capabilities.md");
    await Bun.write(
      filePath,
      `---
loading: contextual
agent-modification: false
---

# stale
`,
    );

    const result = await writeCapabilitiesFile(dir, null, FALLBACK_CONFIG);
    expect(result.createdFile).toBe(false);

    const { meta, content } = parseContextFile(await Bun.file(filePath).text());
    expect(meta.loading).toBe("contextual");
    expect(meta["agent-modification"]).toBe(false);
    expect(content).toContain("# Capabilities");
    expect(content).not.toContain("stale");
  });
});
