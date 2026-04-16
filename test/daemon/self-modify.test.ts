import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { BOTHOLOMEW_DIR } from "../../src/constants.ts";
import { updateBeliefsTool } from "../../src/tools/context/update-beliefs.ts";
import { updateGoalsTool } from "../../src/tools/context/update-goals.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import {
  parseContextFile,
  serializeContextFile,
} from "../../src/utils/frontmatter.ts";
import { setupTestDb } from "../helpers.ts";

let tempDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bth-self-modify-"));
  ctx = {
    conn: await setupTestDb(),
    projectDir: tempDir,
    config: { ...DEFAULT_CONFIG },
    mcpxClient: null,
  };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true });
});

describe("update_beliefs", () => {
  test("creates beliefs.md with default frontmatter when file does not exist", async () => {
    const result = await updateBeliefsTool.execute(
      { content: "I believe in testing." },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.message).toContain("Updated beliefs.md");

    const filePath = join(tempDir, BOTHOLOMEW_DIR, "beliefs.md");
    const raw = await Bun.file(filePath).text();
    const parsed = parseContextFile(raw);
    expect(parsed.meta.loading).toBe("always");
    expect(parsed.meta["agent-modification"]).toBe(true);
    expect(parsed.content).toBe("I believe in testing.");
  });

  test("preserves existing frontmatter when updating", async () => {
    const filePath = join(tempDir, BOTHOLOMEW_DIR, "beliefs.md");
    const original = serializeContextFile(
      { loading: "always", "agent-modification": true },
      "Old beliefs",
    );
    await Bun.write(filePath, original);

    const result = await updateBeliefsTool.execute(
      { content: "New beliefs" },
      ctx,
    );

    expect(result.is_error).toBe(false);
    const raw = await Bun.file(filePath).text();
    const parsed = parseContextFile(raw);
    expect(parsed.meta.loading).toBe("always");
    expect(parsed.meta["agent-modification"]).toBe(true);
    expect(parsed.content).toBe("New beliefs");
  });

  test("rejects modification when agent-modification is false", async () => {
    const filePath = join(tempDir, BOTHOLOMEW_DIR, "beliefs.md");
    const locked = serializeContextFile(
      { loading: "always", "agent-modification": false },
      "Protected beliefs",
    );
    await Bun.write(filePath, locked);

    const result = await updateBeliefsTool.execute(
      { content: "Hacked beliefs" },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.message).toContain("not allowed");

    // Content should be unchanged
    const raw = await Bun.file(filePath).text();
    const parsed = parseContextFile(raw);
    expect(parsed.content).toBe("Protected beliefs");
  });
});

describe("update_goals", () => {
  test("creates goals.md with default frontmatter when file does not exist", async () => {
    const result = await updateGoalsTool.execute(
      { content: "Learn everything." },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.message).toContain("Updated goals.md");

    const filePath = join(tempDir, BOTHOLOMEW_DIR, "goals.md");
    const raw = await Bun.file(filePath).text();
    const parsed = parseContextFile(raw);
    expect(parsed.meta.loading).toBe("always");
    expect(parsed.meta["agent-modification"]).toBe(true);
    expect(parsed.content).toBe("Learn everything.");
  });

  test("preserves existing frontmatter when updating", async () => {
    const filePath = join(tempDir, BOTHOLOMEW_DIR, "goals.md");
    const original = serializeContextFile(
      { loading: "always", "agent-modification": true },
      "Old goals",
    );
    await Bun.write(filePath, original);

    const result = await updateGoalsTool.execute({ content: "New goals" }, ctx);

    expect(result.is_error).toBe(false);
    const raw = await Bun.file(filePath).text();
    const parsed = parseContextFile(raw);
    expect(parsed.content).toBe("New goals");
  });

  test("rejects modification when agent-modification is false", async () => {
    const filePath = join(tempDir, BOTHOLOMEW_DIR, "goals.md");
    const locked = serializeContextFile(
      { loading: "always", "agent-modification": false },
      "Protected goals",
    );
    await Bun.write(filePath, locked);

    const result = await updateGoalsTool.execute(
      { content: "Hacked goals" },
      ctx,
    );

    expect(result.is_error).toBe(true);
    expect(result.message).toContain("not allowed");

    const raw = await Bun.file(filePath).text();
    const parsed = parseContextFile(raw);
    expect(parsed.content).toBe("Protected goals");
  });
});
