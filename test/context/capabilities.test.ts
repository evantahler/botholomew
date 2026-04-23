import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpxClient } from "@evantahler/mcpx";
import {
  generateCapabilitiesMarkdown,
  writeCapabilitiesFile,
} from "../../src/context/capabilities.ts";
import { registerAllTools } from "../../src/tools/registry.ts";
import { parseContextFile } from "../../src/utils/frontmatter.ts";

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

describe("generateCapabilitiesMarkdown", () => {
  test("lists built-in tools grouped with stable headings", async () => {
    const fixed = new Date("2026-01-02T03:04:05Z");
    const { body, counts } = await generateCapabilitiesMarkdown(null, fixed);

    expect(body).toContain("# Capabilities");
    expect(body).toContain("*Generated 2026-01-02T03:04:05.000Z");
    expect(body).toContain("## Internal tools");
    expect(body).toContain("### Task management");
    expect(body).toContain("### Context / virtual filesystem");
    expect(body).toContain("`complete_task`");
    expect(body).toContain("`context_read`");
    expect(counts.internal).toBeGreaterThan(10);
    expect(counts.mcp).toBe(0);
  });

  test("strips bash-equivalent tag from description and appends analog suffix", async () => {
    const { body } = await generateCapabilitiesMarkdown(null);
    // contextReadTool has `[[ bash equivalent command: cat ]]` prefix
    const readLine = body
      .split("\n")
      .find((l) => l.startsWith("- **`context_read`**"));
    expect(readLine).toBeDefined();
    expect(readLine).not.toContain("[[");
    expect(readLine).toContain("≈ `cat`");
  });

  test("renders MCPX section grouped by server and alphabetized", async () => {
    const client = mockClient([
      { server: "slack", name: "post_message", description: "Post a message." },
      {
        server: "gmail",
        name: "send_email",
        description: "Send an email via Gmail.",
      },
      { server: "gmail", name: "list_inbox", description: "List inbox." },
    ]);

    const { body, counts } = await generateCapabilitiesMarkdown(client);
    expect(counts.mcp).toBe(3);
    expect(body).toContain("## MCPX tools");
    expect(body).toContain("### gmail");
    expect(body).toContain("### slack");
    const gmailIdx = body.indexOf("### gmail");
    const slackIdx = body.indexOf("### slack");
    expect(gmailIdx).toBeLessThan(slackIdx);
    const listInboxIdx = body.indexOf("`list_inbox`");
    const sendEmailIdx = body.indexOf("`send_email`");
    expect(listInboxIdx).toBeLessThan(sendEmailIdx);
  });

  test("emits a helpful message when no MCPX client is configured", async () => {
    const { body, counts } = await generateCapabilitiesMarkdown(null);
    expect(body).toContain("No MCPX servers configured");
    expect(counts.mcp).toBe(0);
  });

  test("notes when MCPX is configured but exposes zero tools", async () => {
    const { body, counts } = await generateCapabilitiesMarkdown(mockClient([]));
    expect(body).toContain("MCPX is configured but no tools");
    expect(counts.mcp).toBe(0);
  });

  test("handles an MCPX listTools failure gracefully", async () => {
    const client = {
      listTools: mock(async () => {
        throw new Error("connection refused");
      }),
    } as unknown as McpxClient;

    const { body, counts } = await generateCapabilitiesMarkdown(client);
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
    const result = await writeCapabilitiesFile(dir, null);

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

    const result = await writeCapabilitiesFile(dir, null);
    expect(result.createdFile).toBe(false);

    const { meta, content } = parseContextFile(await Bun.file(filePath).text());
    expect(meta.loading).toBe("contextual");
    expect(meta["agent-modification"]).toBe(false);
    expect(content).toContain("# Capabilities");
    expect(content).not.toContain("stale");
  });
});
