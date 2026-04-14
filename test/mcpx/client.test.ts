import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createMcpxClient,
  formatCallToolResult,
} from "../../src/mcpx/client.ts";

const TMP_DIR = join(import.meta.dir, ".tmp-mcpx-test");
const MCPX_DIR = join(TMP_DIR, ".botholomew", "mcpx");

async function writeTmpServers(content: unknown) {
  mkdirSync(MCPX_DIR, { recursive: true });
  await Bun.write(join(MCPX_DIR, "servers.json"), JSON.stringify(content));
}

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true });
  }
});

describe("createMcpxClient", () => {
  test("returns null when servers.json does not exist", async () => {
    const client = await createMcpxClient(TMP_DIR);
    expect(client).toBeNull();
  });

  test("returns null when mcpServers is empty", async () => {
    await writeTmpServers({ mcpServers: {} });
    const client = await createMcpxClient(TMP_DIR);
    expect(client).toBeNull();
  });

  test("returns McpxClient when servers are configured", async () => {
    await writeTmpServers({
      mcpServers: {
        echo: { command: "echo", args: ["hello"] },
      },
    });
    const client = await createMcpxClient(TMP_DIR);
    expect(client).not.toBeNull();
    await client?.close();
  });
});

describe("formatCallToolResult", () => {
  test("formats text content", () => {
    const result = formatCallToolResult({
      content: [
        { type: "text" as const, text: "Hello" },
        { type: "text" as const, text: "World" },
      ],
    });
    expect(result).toBe("Hello\nWorld");
  });

  test("formats image content", () => {
    const result = formatCallToolResult({
      content: [{ type: "image" as const, data: "...", mimeType: "image/png" }],
    });
    expect(result).toBe("[image: image/png]");
  });

  test("formats resource content", () => {
    const result = formatCallToolResult({
      content: [
        {
          type: "resource" as const,
          resource: { uri: "file:///test.txt", text: "content" },
        },
      ],
    });
    expect(result).toBe("[resource: file:///test.txt]");
  });

  test("handles unknown block types", () => {
    // Cast to any to simulate an unexpected content type from an MCP server
    const result = formatCallToolResult({
      content: [{ type: "custom", data: "something" }] as never,
    });
    expect(result).toContain("custom");
  });

  test("handles missing content array", () => {
    const result = formatCallToolResult({} as never);
    expect(typeof result).toBe("string");
  });
});
