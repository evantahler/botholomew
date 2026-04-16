import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearLargeResults,
  storeLargeResult,
} from "../../src/daemon/large-results.ts";
import { readLargeResultTool } from "../../src/tools/context/read-large-result.ts";
import { updateBeliefsTool } from "../../src/tools/context/update-beliefs.ts";
import { updateGoalsTool } from "../../src/tools/context/update-goals.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { setupToolContext } from "../helpers.ts";

let ctx: ToolContext;
let projectDir: string;

beforeEach(async () => {
  ({ ctx } = await setupToolContext());
  // Use a real temp directory so Bun.write / Bun.file work
  projectDir = await mkdtemp(join(tmpdir(), "botholomew-ctx-test-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(projectDir, ".botholomew"), { recursive: true });
  ctx.projectDir = projectDir;
});

afterEach(async () => {
  clearLargeResults();
  await rm(projectDir, { recursive: true, force: true });
});

// ── update_beliefs ─────────────────────────────────────────

describe("update_beliefs", () => {
  test("creates beliefs.md when it does not exist", async () => {
    const result = await updateBeliefsTool.execute(
      { content: "The sky is blue." },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.message).toContain("Updated beliefs.md");

    const written = await Bun.file(
      join(projectDir, ".botholomew", "beliefs.md"),
    ).text();
    expect(written).toContain("The sky is blue.");
  });

  test("preserves frontmatter on update", async () => {
    const initial = [
      "---",
      "loading: always",
      "agent-modification: true",
      "---",
      "Old beliefs content",
    ].join("\n");
    await Bun.write(join(projectDir, ".botholomew", "beliefs.md"), initial);

    const result = await updateBeliefsTool.execute(
      { content: "New beliefs content" },
      ctx,
    );
    expect(result.is_error).toBe(false);

    const written = await Bun.file(
      join(projectDir, ".botholomew", "beliefs.md"),
    ).text();
    expect(written).toContain("loading: always");
    expect(written).toContain("New beliefs content");
    expect(written).not.toContain("Old beliefs content");
  });

  test("rejects update when agent-modification is false", async () => {
    const locked = [
      "---",
      "loading: always",
      "agent-modification: false",
      "---",
      "Locked content",
    ].join("\n");
    await Bun.write(join(projectDir, ".botholomew", "beliefs.md"), locked);

    const result = await updateBeliefsTool.execute(
      { content: "Attempted update" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("not allowed");
  });
});

// ── update_goals ───────────────────────────────────────────

describe("update_goals", () => {
  test("creates goals.md when it does not exist", async () => {
    const result = await updateGoalsTool.execute({ content: "Ship v1.0" }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.message).toContain("Updated goals.md");

    const written = await Bun.file(
      join(projectDir, ".botholomew", "goals.md"),
    ).text();
    expect(written).toContain("Ship v1.0");
  });

  test("preserves frontmatter on update", async () => {
    const initial = [
      "---",
      "loading: always",
      "agent-modification: true",
      "---",
      "Old goals",
    ].join("\n");
    await Bun.write(join(projectDir, ".botholomew", "goals.md"), initial);

    const result = await updateGoalsTool.execute({ content: "New goals" }, ctx);
    expect(result.is_error).toBe(false);

    const written = await Bun.file(
      join(projectDir, ".botholomew", "goals.md"),
    ).text();
    expect(written).toContain("loading: always");
    expect(written).toContain("New goals");
    expect(written).not.toContain("Old goals");
  });

  test("rejects update when agent-modification is false", async () => {
    const locked = [
      "---",
      "loading: always",
      "agent-modification: false",
      "---",
      "Locked goals",
    ].join("\n");
    await Bun.write(join(projectDir, ".botholomew", "goals.md"), locked);

    const result = await updateGoalsTool.execute(
      { content: "Attempted update" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("not allowed");
  });
});

// ── read_large_result ──────────────────────────────────────

describe("read_large_result", () => {
  test("reads page from stored large result", async () => {
    const id = storeLargeResult("test_tool", "Hello, world!");
    const result = await readLargeResultTool.execute({ id, page: 1 });
    expect(result.is_error).toBe(false);
    expect(result.content).toBe("Hello, world!");
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  test("paginates multi-page results", async () => {
    // Create content larger than PAGE_SIZE_CHARS (8000)
    const content = "x".repeat(20_000);
    const id = storeLargeResult("big_tool", content);

    const page1 = await readLargeResultTool.execute({ id, page: 1 });
    expect(page1.is_error).toBe(false);
    expect(page1.page).toBe(1);
    expect(page1.totalPages).toBe(3);
    expect(page1.content.length).toBe(8_000);

    const page2 = await readLargeResultTool.execute({ id, page: 2 });
    expect(page2.page).toBe(2);
    expect(page2.content.length).toBe(8_000);

    const page3 = await readLargeResultTool.execute({ id, page: 3 });
    expect(page3.page).toBe(3);
    expect(page3.content.length).toBe(4_000);
  });

  test("throws for invalid id", async () => {
    await expect(
      readLargeResultTool.execute({ id: "lr_nonexistent", page: 1 }),
    ).rejects.toThrow("No result found");
  });

  test("throws for out-of-range page", async () => {
    const id = storeLargeResult("tool", "short");
    await expect(
      readLargeResultTool.execute({ id, page: 999 }),
    ).rejects.toThrow("No result found");
  });
});
