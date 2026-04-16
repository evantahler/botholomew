import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import {
  createContextItem,
  getContextItemByPath,
} from "../../src/db/context.ts";
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
  const proc = Bun.spawn(["bun", CLI, "--dir", tempDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("context delete CLI", () => {
  test("deletes an existing context item by path", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    // Seed a context item directly via DB
    const conn = await getConnection(getDbPath(tempDir));
    await migrate(conn);
    await createContextItem(conn, {
      title: "test.md",
      content: "hello",
      contextPath: "/docs/test.md",
    });
    conn.close();

    const result = await run(["context", "delete", "/docs/test.md"]);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toContain(
      "Deleted context item: /docs/test.md",
    );

    // Verify it's actually gone
    const conn2 = await getConnection(getDbPath(tempDir));
    await migrate(conn2);
    const item = await getContextItemByPath(conn2, "/docs/test.md");
    conn2.close();
    expect(item).toBeNull();
  });

  test("exits with error for non-existent path", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const result = await run(["context", "delete", "/no/such/path.md"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      "Context item not found: /no/such/path.md",
    );
  });
});
