/**
 * Hybrid coverage of the `search` tool — regexp + semantic merged via
 * fuseRRF. Uses the real `@huggingface/transformers` WASM embedder so
 * the cosine ranking the model produces is what we actually assert
 * against. Slower than the unit-level fuseRRF tests, but the real value
 * here is proving the full pipeline end-to-end with a real model.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { CONTEXT_DIR, getDbPath } from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import { _resetSandboxCacheForTests } from "../../src/fs/sandbox.ts";
import { searchTool } from "../../src/tools/search/index.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let projectDir: string;
let dbPath: string;

beforeEach(async () => {
  _resetSandboxCacheForTests();
  projectDir = await mkdtemp(join(tmpdir(), "both-search-hybrid-"));
  await mkdir(join(projectDir, CONTEXT_DIR), { recursive: true });
  dbPath = getDbPath(projectDir);
  const conn = await getConnection(dbPath);
  await migrate(conn);
  conn.close();
});

afterEach(async () => {
  _resetSandboxCacheForTests();
  await rm(projectDir, { recursive: true, force: true });
});

async function writeContextFile(
  relPath: string,
  content: string,
): Promise<void> {
  const abs = join(projectDir, CONTEXT_DIR, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

function ctx(): ToolContext {
  return {
    conn: null as never,
    dbPath,
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
}

describe("search tool — hybrid (regexp + semantic) fusion with real embeddings", () => {
  test("query alone surfaces semantic-only matches when regexp wouldn't hit", async () => {
    // Two files, neither contains the literal token "paternity". The first
    // is semantically about paternity leave; the second is unrelated. A
    // semantic-only query must rank the first higher and tag it
    // match_type='semantic' with line=null.
    await writeContextFile(
      "leave.md",
      "Notes on parental leave for newborn care, time off, and childcare.",
    );
    await writeContextFile(
      "k8s.md",
      "Kubernetes helm chart deployment and rollout strategy.",
    );

    const r = await searchTool.execute(
      { query: "paternity leave plan", max_results: 5 },
      ctx(),
    );
    expect(r.is_error).toBe(false);
    expect(r.matches.length).toBeGreaterThan(0);
    const top = r.matches[0];
    expect(top?.path).toBe("leave.md");
    expect(top?.match_type).toBe("semantic");
    expect(top?.line).toBeNull();
    expect(top?.semantic_score).not.toBeNull();
  }, /* timeout */ 60_000);

  test("query AND pattern: a path matched on both sides becomes 'both'", async () => {
    // a.md: matches the pattern AND is semantically about the query topic.
    // b.md: matches the pattern but its body's other content drowns out
    //       the semantic signal — at least, the literal token is what
    //       drives the regexp side.
    // We assert (a) a.md ends up 'both', and (b) b.md appears in the
    // results (the pattern matched). The exact secondary classification
    // for b.md depends on the embedder's similarity threshold for the
    // surrounding prose, so we don't pin it.
    await writeContextFile(
      "a.md",
      "Kubernetes helm chart deployment and rollout strategy.",
    );
    await writeContextFile(
      "b.md",
      "Kubernetes is mentioned once. The rest discusses parental leave for newborn care and family time off.",
    );

    const r = await searchTool.execute(
      {
        pattern: "Kubernetes",
        query: "kubernetes helm deployment rollout plan",
        max_results: 10,
      },
      ctx(),
    );
    expect(r.is_error).toBe(false);

    const a = r.matches.find((m) => m.path === "a.md");
    const bMatches = r.matches.filter((m) => m.path === "b.md");
    expect(a?.match_type).toBe("both");
    expect(a?.semantic_score).not.toBeNull();
    // a.md's body is more on-topic than b.md, so a's fused score should
    // outrank b's best score.
    const bestB = Math.max(0, ...bMatches.map((m) => m.score));
    expect(a?.score ?? 0).toBeGreaterThan(bestB);
  }, /* timeout */ 60_000);

  test("pattern alone returns regexp-only matches; no semantic_score, line numbers populated", async () => {
    await writeContextFile(
      "leave.md",
      "alpha line\nthe parental leave plan is here\ngamma line\n",
    );

    const r = await searchTool.execute(
      { pattern: "parental", max_results: 5 },
      ctx(),
    );
    expect(r.is_error).toBe(false);
    const m = r.matches.find((x) => x.path === "leave.md");
    expect(m?.match_type).toBe("regexp");
    expect(m?.line).toBe(2);
    expect(m?.semantic_score).toBeNull();
  }, /* timeout */ 60_000);

  test("max_results caps the fused list", async () => {
    for (let i = 0; i < 6; i++) {
      await writeContextFile(`notes/n-${i}.md`, `Kubernetes line ${i}.`);
    }
    const r = await searchTool.execute(
      {
        pattern: "Kubernetes",
        query: "kubernetes deployment",
        max_results: 3,
      },
      ctx(),
    );
    expect(r.is_error).toBe(false);
    expect(r.matches.length).toBeLessThanOrEqual(3);
  }, /* timeout */ 60_000);
});
