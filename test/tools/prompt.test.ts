import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getPromptsDir } from "../../src/constants.ts";
import { promptEditTool } from "../../src/tools/prompt/edit.ts";
import { promptReadTool } from "../../src/tools/prompt/read.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let projectDir: string;
let ctx: ToolContext;

async function seedPrompt(name: string, body: string, agentMod = true) {
  const dir = getPromptsDir(projectDir);
  await mkdir(dir, { recursive: true });
  const fm = `---\nloading: always\nagent-modification: ${agentMod}\n---\n\n${body}\n`;
  await writeFile(join(dir, `${name}.md`), fm);
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-prompt-tools-"));
  ctx = {
    conn: null as never,
    dbPath: ":memory:",
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("prompt_read", () => {
  test("reads an existing prompt and reports agent_modification", async () => {
    await seedPrompt("beliefs", "I believe in tests.");
    const r = await promptReadTool.execute({ name: "beliefs" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.content).toContain("I believe in tests.");
    expect(r.agent_modification).toBe(true);
  });

  test("reports agent_modification false for protected prompts", async () => {
    await seedPrompt("soul", "Static soul text.", false);
    const r = await promptReadTool.execute({ name: "soul" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.agent_modification).toBe(false);
  });

  test("returns not_found for missing prompt", async () => {
    const r = await promptReadTool.execute({ name: "ghost" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });

  test("rejects names with slashes", async () => {
    const r = await promptReadTool.execute({ name: "../etc/passwd" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("invalid_name");
  });
});

describe("prompt_edit", () => {
  test("edits the body of an editable prompt", async () => {
    await seedPrompt("beliefs", "old line");
    const filePath = join(getPromptsDir(projectDir), "beliefs.md");
    const before = await Bun.file(filePath).text();
    const lines = before.split("\n");
    const bodyIdx = lines.indexOf("old line") + 1;

    const r = await promptEditTool.execute(
      {
        name: "beliefs",
        patches: [
          { start_line: bodyIdx, end_line: bodyIdx, content: "new line" },
        ],
      },
      ctx,
    );

    expect(r.is_error).toBe(false);
    expect(r.applied).toBe(1);
    const after = await Bun.file(filePath).text();
    expect(after).toContain("new line");
    expect(after).not.toContain("old line");
    expect(after).toMatch(/agent-modification:\s*true/);
  });

  test("refuses to edit when agent-modification is false", async () => {
    await seedPrompt("soul", "static text", false);
    const filePath = join(getPromptsDir(projectDir), "soul.md");
    const before = await Bun.file(filePath).text();

    const r = await promptEditTool.execute(
      {
        name: "soul",
        patches: [{ start_line: 1, end_line: 1, content: "hijack" }],
      },
      ctx,
    );

    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("agent_modification_disabled");
    const after = await Bun.file(filePath).text();
    expect(after).toBe(before);
  });

  test("rolls back when patch clears agent-modification", async () => {
    await seedPrompt("beliefs", "body");
    const filePath = join(getPromptsDir(projectDir), "beliefs.md");
    const before = await Bun.file(filePath).text();
    const lines = before.split("\n");
    const flagIdx =
      lines.findIndex((l) => l.includes("agent-modification")) + 1;

    const r = await promptEditTool.execute(
      {
        name: "beliefs",
        patches: [
          {
            start_line: flagIdx,
            end_line: flagIdx,
            content: "agent-modification: false",
          },
        ],
      },
      ctx,
    );

    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("agent_modification_disabled");
    const after = await Bun.file(filePath).text();
    expect(after).toBe(before);
  });

  test("returns not_found for missing prompt", async () => {
    const r = await promptEditTool.execute(
      {
        name: "ghost",
        patches: [{ start_line: 1, end_line: 1, content: "x" }],
      },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });
});
