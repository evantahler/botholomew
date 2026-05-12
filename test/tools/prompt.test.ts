import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getPromptsDir } from "../../src/constants.ts";
import { promptCreateTool } from "../../src/tools/prompt/create.ts";
import { promptDeleteTool } from "../../src/tools/prompt/delete.ts";
import { promptEditTool } from "../../src/tools/prompt/edit.ts";
import { promptListTool } from "../../src/tools/prompt/list.ts";
import { promptReadTool } from "../../src/tools/prompt/read.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let projectDir: string;
let ctx: ToolContext;

async function seedPrompt(
  name: string,
  body: string,
  opts: { agentMod?: boolean; loading?: "always" | "contextual" } = {},
) {
  const dir = getPromptsDir(projectDir);
  await mkdir(dir, { recursive: true });
  const am = opts.agentMod ?? true;
  const loading = opts.loading ?? "always";
  const fm = `---\ntitle: ${name}\nloading: ${loading}\nagent-modification: ${am}\n---\n\n${body}\n`;
  await writeFile(join(dir, `${name}.md`), fm);
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-prompt-tools-"));
  ctx = {
    withMem: null as never,
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("prompt_read", () => {
  test("reads an existing prompt and reports parsed metadata", async () => {
    await seedPrompt("beliefs", "I believe in tests.");
    const r = await promptReadTool.execute({ name: "beliefs" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.content).toContain("I believe in tests.");
    expect(r.title).toBe("beliefs");
    expect(r.loading).toBe("always");
    expect(r.agent_modification).toBe(true);
  });

  test("reports agent_modification false for protected prompts", async () => {
    await seedPrompt("soul", "Static soul text.", { agentMod: false });
    const r = await promptReadTool.execute({ name: "soul" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.agent_modification).toBe(false);
  });

  test("returns invalid_frontmatter for malformed prompt", async () => {
    const dir = getPromptsDir(projectDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "broken.md"), "no frontmatter here\n");
    const r = await promptReadTool.execute({ name: "broken" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("invalid_frontmatter");
    // Raw content is still returned so the agent can repair it.
    expect(r.content).toContain("no frontmatter here");
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

describe("prompt_list", () => {
  test("returns an empty list when prompts/ is missing or empty", async () => {
    const r = await promptListTool.execute({ limit: 100, offset: 0 }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.total).toBe(0);
    expect(r.prompts).toHaveLength(0);
  });

  test("returns metadata for each prompt", async () => {
    await seedPrompt("goals", "be helpful");
    await seedPrompt("notes", "scratchpad", { loading: "contextual" });
    const r = await promptListTool.execute({ limit: 100, offset: 0 }, ctx);
    expect(r.total).toBe(2);
    const names = r.prompts.map((p) => p.name).sort();
    expect(names).toEqual(["goals", "notes"]);
    const notes = r.prompts.find((p) => p.name === "notes");
    expect(notes?.loading).toBe("contextual");
    expect(notes?.valid).toBe(true);
  });

  test("flags invalid prompts without aborting the list", async () => {
    await seedPrompt("goals", "ok");
    const dir = getPromptsDir(projectDir);
    await writeFile(join(dir, "broken.md"), "no frontmatter\n");
    const r = await promptListTool.execute({ limit: 100, offset: 0 }, ctx);
    expect(r.total).toBe(2);
    const broken = r.prompts.find((p) => p.name === "broken");
    expect(broken?.valid).toBe(false);
    expect(broken?.error).toBeTruthy();
    const goals = r.prompts.find((p) => p.name === "goals");
    expect(goals?.valid).toBe(true);
  });
});

describe("prompt_create", () => {
  test("creates a new prompt with strict frontmatter", async () => {
    const r = await promptCreateTool.execute(
      {
        name: "scratch",
        title: "Scratch",
        loading: "contextual",
        agent_modification: true,
        body: "- a note",
        on_conflict: "error",
      },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.created).toBe(true);
    const filePath = join(getPromptsDir(projectDir), "scratch.md");
    expect(await Bun.file(filePath).exists()).toBe(true);
    const text = await Bun.file(filePath).text();
    expect(text).toMatch(/title:\s*Scratch/);
    expect(text).toMatch(/loading:\s*contextual/);
    expect(text).toMatch(/agent-modification:\s*true/);
    expect(text).toContain("- a note");
  });

  test("rejects invalid names", async () => {
    const r = await promptCreateTool.execute(
      {
        name: "../etc/passwd",
        title: "x",
        loading: "always",
        agent_modification: true,
        body: "x",
        on_conflict: "error",
      },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("invalid_name");
  });

  test("returns path_conflict when the prompt already exists", async () => {
    await seedPrompt("dup", "existing");
    const r = await promptCreateTool.execute(
      {
        name: "dup",
        title: "Dup",
        loading: "always",
        agent_modification: true,
        body: "new body",
        on_conflict: "error",
      },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("path_conflict");
  });

  test("overwrites when on_conflict='overwrite'", async () => {
    await seedPrompt("dup", "existing");
    const r = await promptCreateTool.execute(
      {
        name: "dup",
        title: "Dup",
        loading: "always",
        agent_modification: true,
        body: "new body",
        on_conflict: "overwrite",
      },
      ctx,
    );
    expect(r.is_error).toBe(false);
    const text = await Bun.file(
      join(getPromptsDir(projectDir), "dup.md"),
    ).text();
    expect(text).toContain("new body");
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
    await seedPrompt("soul", "static text", { agentMod: false });
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

  test("returns invalid_frontmatter if the patch breaks the schema", async () => {
    await seedPrompt("beliefs", "body");
    const filePath = join(getPromptsDir(projectDir), "beliefs.md");
    const before = await Bun.file(filePath).text();
    const lines = before.split("\n");
    const titleIdx = lines.findIndex((l) => l.startsWith("title:")) + 1;

    const r = await promptEditTool.execute(
      {
        name: "beliefs",
        patches: [
          // Drop the title field entirely — schema requires it.
          { start_line: titleIdx, end_line: titleIdx, content: "" },
        ],
      },
      ctx,
    );

    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("invalid_frontmatter");
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

describe("prompt_delete", () => {
  test("deletes an editable prompt", async () => {
    await seedPrompt("scratch", "doomed");
    const filePath = join(getPromptsDir(projectDir), "scratch.md");
    expect(await Bun.file(filePath).exists()).toBe(true);

    const r = await promptDeleteTool.execute({ name: "scratch" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.deleted).toBe(true);
    expect(await Bun.file(filePath).exists()).toBe(false);
  });

  test("refuses to delete a protected prompt", async () => {
    await seedPrompt("soul", "static", { agentMod: false });
    const r = await promptDeleteTool.execute({ name: "soul" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("agent_modification_disabled");
    const filePath = join(getPromptsDir(projectDir), "soul.md");
    expect(await Bun.file(filePath).exists()).toBe(true);
  });

  test("returns not_found for missing prompt", async () => {
    const r = await promptDeleteTool.execute({ name: "ghost" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });

  test("can delete a malformed prompt (so the agent can clean up)", async () => {
    const dir = getPromptsDir(projectDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "broken.md"), "no frontmatter\n");
    const r = await promptDeleteTool.execute({ name: "broken" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.deleted).toBe(true);
  });
});
