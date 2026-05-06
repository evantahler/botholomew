/**
 * Concurrency stress tests for `writeContextFile` and `applyPatches`.
 *
 * Reproducer for a user-reported issue ("3 workers wrote 3 distinct files,
 * only 1 survived"). The distinct-path test pins down that concurrent writes
 * to different paths all reach disk; the same-path test pins down that
 * concurrent overwrite/edit either converges to a single committed value or
 * surfaces a structured conflict — never silently loses one writer's bytes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_DIR } from "../../src/constants.ts";
import {
  applyPatches,
  readContextFile,
  writeContextFile,
} from "../../src/context/store.ts";
import { _resetSandboxCacheForTests } from "../../src/fs/sandbox.ts";

let projectDir: string;

beforeEach(async () => {
  _resetSandboxCacheForTests();
  projectDir = await mkdtemp(join(tmpdir(), "both-concurrency-"));
  await mkdir(join(projectDir, CONTEXT_DIR), { recursive: true });
});

afterEach(async () => {
  _resetSandboxCacheForTests();
  await rm(projectDir, { recursive: true, force: true });
});

describe("concurrent context writes", () => {
  test("N parallel writes to distinct paths in the same dir all survive", async () => {
    const N = 16;
    const writes = Array.from({ length: N }, (_, i) =>
      writeContextFile(
        projectDir,
        `poems/rain-poem-${i + 1}.md`,
        `poem ${i + 1} content`,
      ),
    );
    const entries = await Promise.all(writes);
    expect(entries).toHaveLength(N);

    for (let i = 0; i < N; i++) {
      const abs = join(
        projectDir,
        CONTEXT_DIR,
        "poems",
        `rain-poem-${i + 1}.md`,
      );
      const content = await readFile(abs, "utf-8");
      expect(content).toBe(`poem ${i + 1} content`);
    }
  });

  test("N parallel writes to the same path converge to one of the values", async () => {
    const N = 8;
    await writeContextFile(projectDir, "shared.md", "seed");
    const writes = Array.from({ length: N }, (_, i) =>
      writeContextFile(projectDir, "shared.md", `value-${i}`, {
        onConflict: "overwrite",
      }),
    );
    const results = await Promise.allSettled(writes);
    // The per-path lock serializes them with retry — every writer should
    // commit within the budget, and the file ends up holding the value of
    // whichever rename ran last (never a torn or empty result).
    for (const r of results) expect(r.status).toBe("fulfilled");

    const final = await readContextFile(projectDir, "shared.md");
    expect(final).toMatch(/^value-\d+$/);
  });

  test("N parallel applyPatches to distinct files don't lose edits", async () => {
    const N = 8;
    for (let i = 0; i < N; i++) {
      await writeContextFile(projectDir, `notes/n-${i}.md`, "line1\nline2\n");
    }
    const edits = Array.from({ length: N }, (_, i) =>
      applyPatches(projectDir, `notes/n-${i}.md`, [
        { start_line: 1, end_line: 1, content: `EDITED-${i}` },
      ]),
    );
    await Promise.all(edits);

    for (let i = 0; i < N; i++) {
      const content = await readContextFile(projectDir, `notes/n-${i}.md`);
      expect(content).toBe(`EDITED-${i}\nline2\n`);
    }
  });
});
