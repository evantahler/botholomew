import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPromptsDir } from "../../src/constants.ts";
import type { Task } from "../../src/tasks/schema.ts";
import { PromptValidationError } from "../../src/utils/frontmatter.ts";
import {
  buildSystemPrompt,
  extractKeywords,
  loadPersistentContext,
  STYLE_RULES,
} from "../../src/worker/prompt.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-prompt-"));
  await mkdir(getPromptsDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function writePrompt(name: string, body: string): Promise<void> {
  await writeFile(join(getPromptsDir(projectDir), name), body);
}

function fakePrompt(opts: {
  title: string;
  loading: "always" | "contextual";
  body: string;
  agentMod?: boolean;
}): string {
  const am = opts.agentMod ?? true;
  return `---\ntitle: ${opts.title}\nloading: ${opts.loading}\nagent-modification: ${am}\n---\n\n${opts.body}\n`;
}

function fakeTask(name: string, description: string): Task {
  return {
    id: "t-1",
    name,
    description,
    priority: "medium",
    status: "in_progress",
    blocked_by: [],
    context_paths: [],
    output: null,
    waiting_reason: null,
    claimed_by: "worker-1",
    claimed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    mtimeMs: Date.now(),
    body: description,
  };
}

describe("extractKeywords", () => {
  test("lowercases, splits, drops words ≤ 3 chars", () => {
    const kws = extractKeywords("The fox jumps over a lazy dog");
    // 'the', 'fox', 'a' are filtered; the rest stay.
    expect([...kws].sort()).toEqual(["jumps", "lazy"].concat(["over"]).sort());
  });

  test("returns an empty set for empty input", () => {
    expect(extractKeywords("").size).toBe(0);
  });
});

describe("loadPersistentContext", () => {
  test("includes 'always' files unconditionally", async () => {
    await writePrompt(
      "soul.md",
      fakePrompt({ title: "Soul", loading: "always", body: "I am the agent." }),
    );
    const out = await loadPersistentContext(projectDir);
    expect(out).toContain("soul.md");
    expect(out).toContain("I am the agent.");
  });

  test("includes 'contextual' files only when keywords overlap", async () => {
    await writePrompt(
      "deploy.md",
      fakePrompt({
        title: "Deploy",
        loading: "contextual",
        body: "Deployment runbook.",
      }),
    );
    const noKw = await loadPersistentContext(projectDir);
    expect(noKw).not.toContain("deploy.md");

    const match = await loadPersistentContext(
      projectDir,
      new Set(["deployment"]),
    );
    expect(match).toContain("deploy.md");
    expect(match).toContain("Deployment runbook.");
  });

  test("excludes 'contextual' files when keywords don't overlap", async () => {
    await writePrompt(
      "deploy.md",
      fakePrompt({
        title: "Deploy",
        loading: "contextual",
        body: "Deployment runbook.",
      }),
    );
    const out = await loadPersistentContext(
      projectDir,
      new Set(["unrelated", "topic"]),
    );
    expect(out).not.toContain("deploy.md");
  });

  test("ignores non-md files in prompts/", async () => {
    await writePrompt("not-md.txt", "ignored");
    const out = await loadPersistentContext(projectDir);
    expect(out).not.toContain("ignored");
  });

  test("returns empty string when prompts/ is empty", async () => {
    expect(await loadPersistentContext(projectDir)).toBe("");
  });

  test("returns empty string gracefully when prompts/ is missing", async () => {
    await rm(getPromptsDir(projectDir), { recursive: true, force: true });
    expect(await loadPersistentContext(projectDir)).toBe("");
  });

  test("throws PromptValidationError when a prompt has invalid frontmatter", async () => {
    await writePrompt("broken.md", "just a body, no frontmatter\n");
    await expect(loadPersistentContext(projectDir)).rejects.toBeInstanceOf(
      PromptValidationError,
    );
  });

  test("validation error names the offending file", async () => {
    await writePrompt("broken.md", "just a body, no frontmatter\n");
    try {
      await loadPersistentContext(projectDir);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptValidationError);
      expect((err as Error).message).toContain("broken.md");
    }
  });
});

describe("buildSystemPrompt", () => {
  test("includes the meta header with version and project dir", async () => {
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toMatch(/# Botholomew v\d+\.\d+\.\d+/);
    expect(prompt).toContain(projectDir);
  });

  test("includes UTC time, local time, and IANA timezone in the meta header", async () => {
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toMatch(
      /Current time \(UTC\): \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(prompt).toContain("Current time (local):");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(prompt).toContain(`Timezone: ${timezone}`);
  });

  test("includes the Instructions section and the Style block", async () => {
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain(STYLE_RULES);
    expect(prompt.indexOf("## Instructions")).toBeLessThan(
      prompt.indexOf(STYLE_RULES),
    );
  });

  test("includes always-loaded prompt files", async () => {
    await writePrompt(
      "soul.md",
      fakePrompt({
        title: "Soul",
        loading: "always",
        body: "I am the wise owl.",
      }),
    );
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toContain("I am the wise owl.");
  });

  test("includes contextual files when task keywords match", async () => {
    await writePrompt(
      "deploy.md",
      fakePrompt({
        title: "Deploy",
        loading: "contextual",
        body: "Deployment runbook.",
      }),
    );
    const task = fakeTask("Deploy app", "Push deployment to prod");
    const prompt = await buildSystemPrompt(projectDir, task);
    expect(prompt).toContain("Deployment runbook.");
  });

  test("excludes contextual files when no task is provided", async () => {
    await writePrompt(
      "deploy.md",
      fakePrompt({
        title: "Deploy",
        loading: "contextual",
        body: "Deployment runbook.",
      }),
    );
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).not.toContain("Deployment runbook.");
  });

  test("includes MCP guidance when hasMcpTools is true", async () => {
    const prompt = await buildSystemPrompt(projectDir, undefined, undefined, {
      hasMcpTools: true,
    });
    expect(prompt).toContain("## External Tools (MCP)");
    expect(prompt).toContain("Local knowledge store first");
    expect(prompt).toContain("mcp_info");
  });

  test("omits MCP guidance when hasMcpTools is false", async () => {
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).not.toContain("## External Tools (MCP)");
  });

  test("Style block lands after the MCP block when both are present", async () => {
    const prompt = await buildSystemPrompt(projectDir, undefined, undefined, {
      hasMcpTools: true,
    });
    const mcpIdx = prompt.indexOf("## External Tools (MCP)");
    const styleIdx = prompt.indexOf(STYLE_RULES);
    expect(mcpIdx).toBeGreaterThan(0);
    expect(styleIdx).toBeGreaterThan(mcpIdx);
  });
});
