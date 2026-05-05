import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpxClient } from "@evantahler/mcpx";
import { capabilitiesRefreshTool } from "../../src/tools/capabilities/refresh.ts";
import { registerAllTools } from "../../src/tools/registry.ts";
import { parseContextFile } from "../../src/utils/frontmatter.ts";
import { setupToolContext } from "../helpers.ts";

let tempDir: string;

beforeEach(() => {
  registerAllTools();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function makeProjectDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "both-caps-tool-"));
  await mkdir(join(tempDir, "prompts"), { recursive: true });
  return tempDir;
}

describe("capabilities_refresh tool", () => {
  test("creates capabilities.md with correct counts and default frontmatter", async () => {
    const { ctx } = await setupToolContext();
    ctx.projectDir = await makeProjectDir();

    const result = await capabilitiesRefreshTool.execute({}, ctx);

    expect(result.is_error).toBe(false);
    expect(result.created_file).toBe(true);
    expect(result.internal_tool_count).toBeGreaterThan(10);
    expect(result.mcp_tool_count).toBe(0);
    expect(result.path).toBe(
      join(ctx.projectDir, "prompts", "capabilities.md"),
    );

    if (!result.path) throw new Error("expected non-null path");
    const raw = await Bun.file(result.path).text();
    const { meta, content } = parseContextFile(raw);
    expect(meta.loading).toBe("always");
    expect(meta["agent-modification"]).toBe(true);
    expect(content).toContain("# Capabilities");
  });

  test("includes MCPX tools when client is present", async () => {
    const { ctx } = await setupToolContext();
    ctx.projectDir = await makeProjectDir();
    ctx.mcpxClient = {
      listTools: mock(async () => [
        {
          server: "gmail",
          tool: { name: "send_email", description: "Send an email." },
        },
      ]),
    } as unknown as McpxClient;

    const result = await capabilitiesRefreshTool.execute({}, ctx);
    expect(result.mcp_tool_count).toBe(1);
    if (!result.path) throw new Error("expected non-null path");
    const body = await Bun.file(result.path).text();
    // Fallback mode (no API key in test config): renders the server name
    // with a tool count, not individual tool names.
    expect(body).toContain("**gmail** — 1 tool(s)");
    expect(body).not.toContain("`send_email`");
  });

  test("skips MCPX when include_mcp is false", async () => {
    const { ctx } = await setupToolContext();
    ctx.projectDir = await makeProjectDir();
    ctx.mcpxClient = {
      listTools: mock(async () => [
        {
          server: "gmail",
          tool: { name: "send_email", description: "Send an email." },
        },
      ]),
    } as unknown as McpxClient;

    const result = await capabilitiesRefreshTool.execute(
      { include_mcp: false },
      ctx,
    );
    expect(result.mcp_tool_count).toBe(0);
    if (!result.path) throw new Error("expected non-null path");
    const body = await Bun.file(result.path).text();
    expect(body).toContain("No MCPX servers configured");
  });

  test("marks created_file false on subsequent refresh", async () => {
    const { ctx } = await setupToolContext();
    ctx.projectDir = await makeProjectDir();
    await capabilitiesRefreshTool.execute({}, ctx);

    const second = await capabilitiesRefreshTool.execute({}, ctx);
    expect(second.is_error).toBe(false);
    expect(second.created_file).toBe(false);
  });
});
