import type { BotholomewConfig } from "../src/config/schemas.ts";
import { DEFAULT_CONFIG } from "../src/config/schemas.ts";
import { EMBEDDING_DIMENSION } from "../src/constants.ts";
import { type DbConnection, getConnection } from "../src/db/connection.ts";
import { createContextItem } from "../src/db/context.ts";
import { migrate } from "../src/db/schema.ts";
import type { ToolContext } from "../src/tools/tool.ts";

// ---------------------------------------------------------------------------
// Mock helpers — Anthropic SDK
// ---------------------------------------------------------------------------

/** Standard LLM response shape returned by mock Anthropic clients. */
export interface MockLLMResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** Build a simple "complete_task" response for mock LLM. */
export function completionResponse(
  summary = "Task done successfully",
): MockLLMResponse {
  return {
    content: [
      { type: "text", text: "I'll complete this task." },
      {
        type: "tool_use",
        id: "tool_1",
        name: "complete_task",
        input: { summary },
      },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/**
 * Mock Anthropic SDK module value for `beta.models.retrieve()`.
 *
 * Returns `max_input_tokens: 100_000` for most models, throws for `"fail-model"`.
 * Use with `mock.module("@anthropic-ai/sdk", () => ({ default: MockAnthropicModels }))`.
 */
export class MockAnthropicModels {
  beta = {
    models: {
      retrieve: async (model: string) => {
        if (model === "fail-model") throw new Error("API error");
        return { max_input_tokens: 100_000 };
      },
    },
  };
}

/** Suppressed logger — all methods are no-ops. Usable with `mock.module()`. */
export const silentLogger = {
  logger: {
    info: () => {},
    success: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    dim: () => {},
  },
};

// ---------------------------------------------------------------------------
// Mock helpers — embeddings
// ---------------------------------------------------------------------------

/** Mock embedder that returns zero vectors without calling a real API. */
export const mockEmbed = async (texts: string[]) =>
  texts.map(() => new Array(EMBEDDING_DIMENSION).fill(0));

/** Mock single-text embedder (returns a zero vector). */
export const mockEmbedSingle = async () =>
  new Array(EMBEDDING_DIMENSION).fill(0);

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------

/** Daemon config suitable for tests — includes a fake API key. */
export const TEST_CONFIG: Required<BotholomewConfig> = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
};

/** Create a fresh in-memory database with migrations applied. */
export async function setupTestDb(): Promise<DbConnection> {
  const conn = await getConnection();
  await migrate(conn);
  return conn;
}

/** Create a ToolContext backed by a fresh in-memory database. */
export async function setupToolContext(): Promise<{
  conn: DbConnection;
  ctx: ToolContext;
}> {
  const conn = await setupTestDb();
  const ctx: ToolContext = {
    conn,
    projectDir: "/tmp/test",
    config: { ...DEFAULT_CONFIG },
    mcpxClient: null,
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
