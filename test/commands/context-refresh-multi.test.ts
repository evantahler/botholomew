import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import { createContextItem, getContextItem } from "../../src/db/context.ts";
import { migrate } from "../../src/db/schema.ts";
import { initProject } from "../../src/init/index.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

async function run(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { OPENAI_API_KEY: _omit, ...envWithoutKey } = process.env;
  const proc = Bun.spawn(["bun", CLI, "--dir", tempDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...envWithoutKey, NO_COLOR: "1", BOTHOLOMEW_LOG_LEVEL: "info" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function seedFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  const conn = await getConnection(getDbPath(tempDir));
  try {
    await migrate(conn);
    await createContextItem(conn, {
      title: filePath.split("/").pop() ?? "seeded",
      content,
      drive: "disk",
      path: filePath,
    });
  } finally {
    conn.close();
  }
}

describe("context refresh (multi-path)", () => {
  test("refreshes multiple disk items in a single invocation", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const pathA = join(tempDir, "a.md");
    const pathB = join(tempDir, "b.md");
    await seedFile(pathA, "v1-a");
    await seedFile(pathB, "v1-b");
    await writeFile(pathA, "v2-a");
    await writeFile(pathB, "v2-b");

    const result = await run(["context", "refresh", pathA, pathB]);

    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Checked 2 item(s): 2 updated");

    const conn = await getConnection(getDbPath(tempDir));
    try {
      await migrate(conn);
      const a = await getContextItem(conn, { drive: "disk", path: pathA });
      const b = await getContextItem(conn, { drive: "disk", path: pathB });
      expect(a?.content).toBe("v2-a");
      expect(b?.content).toBe("v2-b");
    } finally {
      conn.close();
    }
  });

  test("warns per unresolved ref but refreshes the rest", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const realPath = join(tempDir, "real.md");
    const bogusPath = join(tempDir, "does-not-exist.md");
    await seedFile(realPath, "v1");
    await writeFile(realPath, "v2");

    const result = await run(["context", "refresh", realPath, bogusPath]);

    expect(result.code).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain(`Not found: ${bogusPath}`);
    expect(output).toContain("Checked 1 item(s): 1 updated");

    const conn = await getConnection(getDbPath(tempDir));
    try {
      await migrate(conn);
      const item = await getContextItem(conn, {
        drive: "disk",
        path: realPath,
      });
      expect(item?.content).toBe("v2");
    } finally {
      conn.close();
    }
  });

  test("exits 1 when all refs fail to resolve", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const bogus1 = join(tempDir, "bogus1.md");
    const bogus2 = join(tempDir, "bogus2.md");

    const result = await run(["context", "refresh", bogus1, bogus2]);

    expect(result.code).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain(`Not found: ${bogus1}`);
    expect(output).toContain(`Not found: ${bogus2}`);
    expect(output).toContain("No matching context entries found.");
  });
});
