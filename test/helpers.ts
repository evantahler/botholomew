import { DEFAULT_CONFIG } from "../src/config/schemas.ts";
import { EMBEDDING_DIMENSION } from "../src/constants.ts";
import type { EmbedFn } from "../src/context/embedder.ts";
import { type DbConnection, getConnection } from "../src/db/connection.ts";
import { createContextItem } from "../src/db/context.ts";
import { migrate } from "../src/db/schema.ts";
import type { ToolContext } from "../src/tools/tool.ts";

/** Mock embedder that returns zero vectors without loading a real model. */
export const mockEmbed: EmbedFn = async (texts: string[]) =>
  texts.map(() => new Array(EMBEDDING_DIMENSION).fill(0));

/** Create a fresh in-memory database with migrations applied. */
export function setupTestDb(): DbConnection {
  const conn = getConnection(":memory:");
  migrate(conn);
  return conn;
}

/** Create a ToolContext backed by a fresh in-memory database. */
export function setupToolContext(): { conn: DbConnection; ctx: ToolContext } {
  const conn = setupTestDb();
  const ctx: ToolContext = {
    conn,
    projectDir: "/tmp/test",
    config: { ...DEFAULT_CONFIG },
    mcpxClient: null,
    embedFn: mockEmbed,
  };
  return { conn, ctx };
}

/** Seed a text file into the virtual filesystem. */
export async function seedFile(
  conn: DbConnection,
  path: string,
  content: string,
  opts?: { title?: string; description?: string },
) {
  return createContextItem(conn, {
    title: opts?.title ?? path.split("/").pop() ?? path,
    description: opts?.description,
    content,
    contextPath: path,
    mimeType: "text/plain",
    isTextual: true,
  });
}

/** Seed a binary (non-textual) file into the virtual filesystem. */
export async function seedBinaryFile(conn: DbConnection, path: string) {
  return createContextItem(conn, {
    title: path.split("/").pop() ?? path,
    content: undefined,
    contextPath: path,
    mimeType: "application/octet-stream",
    isTextual: false,
  });
}

/** Seed a directory entry into the virtual filesystem. */
export async function seedDir(conn: DbConnection, path: string) {
  return createContextItem(conn, {
    title: path.split("/").pop() ?? path,
    contextPath: path,
    mimeType: "inode/directory",
    isTextual: false,
  });
}
