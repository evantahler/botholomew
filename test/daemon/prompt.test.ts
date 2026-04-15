import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeContextFile } from "../../src/utils/frontmatter.ts";

// Mock the embedder to avoid loading the real model
mock.module("../../src/context/embedder.ts", () => ({
  embedSingle: async () => new Array(384).fill(0),
}));

// Mock the logger to suppress output
mock.module("../../src/utils/logger.ts", () => ({
  logger: {
    info: () => {},
    success: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    dim: () => {},
  },
}));

const { buildSystemPrompt } = await import("../../src/daemon/prompt.ts");

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "botholomew-prompt-test-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(projectDir, ".botholomew"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("buildSystemPrompt", () => {
  test("includes meta information", async () => {
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toContain("# Botholomew");
    expect(prompt).toContain("Current time:");
    expect(prompt).toContain(`Project directory: ${projectDir}`);
    expect(prompt).toContain("OS:");
  });

  test("includes instructions section", async () => {
    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("Botholomew");
    expect(prompt).toContain("complete_task");
    expect(prompt).toContain("fail_task");
    expect(prompt).toContain("wait_task");
  });

  test("includes always-loaded context files", async () => {
    const content = serializeContextFile(
      { loading: "always", "agent-modification": false },
      "I am the soul of the project.",
    );
    await Bun.write(join(projectDir, ".botholomew", "soul.md"), content);

    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toContain("## soul.md");
    expect(prompt).toContain("I am the soul of the project.");
  });

  test("includes multiple always-loaded files", async () => {
    const soul = serializeContextFile(
      { loading: "always", "agent-modification": false },
      "Soul content here.",
    );
    const beliefs = serializeContextFile(
      { loading: "always", "agent-modification": true },
      "Beliefs content here.",
    );
    await Bun.write(join(projectDir, ".botholomew", "soul.md"), soul);
    await Bun.write(join(projectDir, ".botholomew", "beliefs.md"), beliefs);

    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).toContain("Soul content here.");
    expect(prompt).toContain("Beliefs content here.");
  });

  test("excludes contextual files when no task is provided", async () => {
    const contextual = serializeContextFile(
      { loading: "contextual", "agent-modification": false },
      "This is contextual content about databases.",
    );
    await Bun.write(
      join(projectDir, ".botholomew", "databases.md"),
      contextual,
    );

    const prompt = await buildSystemPrompt(projectDir);
    expect(prompt).not.toContain("databases.md");
    expect(prompt).not.toContain("contextual content about databases");
  });

  test("includes contextual files when task keywords match", async () => {
    const contextual = serializeContextFile(
      { loading: "contextual", "agent-modification": false },
      "Information about database migrations and schema changes.",
    );
    await Bun.write(
      join(projectDir, ".botholomew", "databases.md"),
      contextual,
    );

    const task = {
      id: "test-id",
      name: "Run database migration",
      description: "Apply the latest schema changes to the database",
      priority: "medium" as const,
      status: "in_progress" as const,
      waiting_reason: null,
      claimed_by: "daemon",
      claimed_at: new Date(),
      blocked_by: [],
      context_ids: [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    const prompt = await buildSystemPrompt(projectDir, task);
    expect(prompt).toContain("databases.md (contextual)");
    expect(prompt).toContain("database migrations");
  });

  test("excludes contextual files when task keywords do not match", async () => {
    const contextual = serializeContextFile(
      { loading: "contextual", "agent-modification": false },
      "Information about underwater basket weaving techniques.",
    );
    await Bun.write(join(projectDir, ".botholomew", "weaving.md"), contextual);

    const task = {
      id: "test-id",
      name: "Fix API endpoint",
      description: "The /users endpoint returns 500",
      priority: "high" as const,
      status: "in_progress" as const,
      waiting_reason: null,
      claimed_by: "daemon",
      claimed_at: new Date(),
      blocked_by: [],
      context_ids: [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    const prompt = await buildSystemPrompt(projectDir, task);
    expect(prompt).not.toContain("weaving.md");
    expect(prompt).not.toContain("underwater basket weaving");
  });

  test("ignores non-md files in .botholomew directory", async () => {
    await Bun.write(
      join(projectDir, ".botholomew", "config.json"),
      '{"key": "value"}',
    );
    await Bun.write(
      join(projectDir, ".botholomew", "data.sqlite"),
      "binary data",
    );

    const prompt = await buildSystemPrompt(projectDir);
    // Should not crash and should not include non-md files
    expect(prompt).not.toContain("config.json");
    expect(prompt).not.toContain("data.sqlite");
  });

  test("handles empty .botholomew directory gracefully", async () => {
    const prompt = await buildSystemPrompt(projectDir);
    // Should still produce a valid prompt with meta + instructions
    expect(prompt).toContain("# Botholomew");
    expect(prompt).toContain("## Instructions");
  });

  test("handles missing .botholomew directory gracefully", async () => {
    await rm(join(projectDir, ".botholomew"), {
      recursive: true,
      force: true,
    });

    const prompt = await buildSystemPrompt(projectDir);
    // Should still produce a valid prompt
    expect(prompt).toContain("# Botholomew");
    expect(prompt).toContain("## Instructions");
  });

  test("keyword extraction filters short words", async () => {
    const contextual = serializeContextFile(
      { loading: "contextual", "agent-modification": false },
      "Content about deployment strategies and pipelines.",
    );
    await Bun.write(join(projectDir, ".botholomew", "deploy.md"), contextual);

    // Task with very short words (should be filtered out) plus "deployment"
    const task = {
      id: "test-id",
      name: "Fix the deployment",
      description: "It is not working",
      priority: "medium" as const,
      status: "in_progress" as const,
      waiting_reason: null,
      claimed_by: "daemon",
      claimed_at: new Date(),
      blocked_by: [],
      context_ids: [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    const prompt = await buildSystemPrompt(projectDir, task);
    // "deployment" (>3 chars) should match "deployment" in content
    expect(prompt).toContain("deploy.md (contextual)");
  });
});
