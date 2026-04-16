import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/constants.ts";
import { getConnection } from "../../src/db/connection.ts";
import { createContextItem } from "../../src/db/context.ts";
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

describe("context show CLI", () => {
  test("shows details and content of a textual context item", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = getConnection(getDbPath(tempDir));
    migrate(conn);
    await createContextItem(conn, {
      title: "test.md",
      content: "# Hello World\n\nSome content here.",
      contextPath: "/docs/test.md",
      mimeType: "text/markdown",
      isTextual: true,
    });
    conn.close();

    const result = await run(["context", "show", "/docs/test.md"]);
    expect(result.code).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("test.md");
    expect(output).toContain("/docs/test.md");
    expect(output).toContain("text/markdown");
    expect(output).toContain("# Hello World");
    expect(output).toContain("Some content here.");
  });

  test("exits with error for non-existent path", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const result = await run(["context", "show", "/no/such/path.md"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      "Context item not found: /no/such/path.md",
    );
  });

  test("shows binary note for non-textual items", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "botholomew-test-"));
    await initProject(tempDir);

    const conn = getConnection(getDbPath(tempDir));
    migrate(conn);
    await createContextItem(conn, {
      title: "image.png",
      contextPath: "/assets/image.png",
      mimeType: "image/png",
      isTextual: false,
    });
    conn.close();

    const result = await run(["context", "show", "/assets/image.png"]);
    expect(result.code).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("image.png");
    expect(output).toContain("image/png");
    expect(output).toContain("binary content not shown");
  });
});
