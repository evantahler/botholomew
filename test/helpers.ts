import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    phase: () => {},
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

/**
 * Content-aware deterministic embedder for search-pipeline tests.
 *
 * Unlike `mockEmbed` (zero vectors), this produces vectors whose cosine
 * similarity tracks word overlap: each vocab word maps to a dedicated hot
 * dimension, the resulting vector is unit-normalized, and two texts sharing
 * any vocab word produce a positive dot product.
 *
 * Use for tests that exercise `searchEmbeddings` / `hybridSearch` — zero
 * vectors produce valid-but-meaningless cosine distances and mask real bugs.
 */
const FAKE_EMBED_VOCAB: Record<string, number> = {
  paternity: 10,
  leave: 20,
  parental: 30,
  time: 40,
  off: 50,
  newborn: 60,
  plan: 70,
  childcare: 80,
  revenue: 100,
  forecast: 110,
  quota: 120,
  kubernetes: 200,
  helm: 210,
  deployment: 220,
  rollout: 230,
};

export function fakeEmbed(text: string): number[] {
  const v = new Array(EMBEDDING_DIMENSION).fill(0);
  const lower = text.toLowerCase();
  for (const [word, dim] of Object.entries(FAKE_EMBED_VOCAB)) {
    if (lower.includes(word)) v[dim] = 1;
  }
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag === 0 ? v : v.map((x) => x / mag);
}

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

/**
 * Create a fresh file-backed database with migrations applied. Use this when
 * a test needs to pass a `dbPath` to production code that opens/closes its
 * own connections — `:memory:` can't be shared across `withDb` calls.
 *
 * Returns `{ conn, dbPath, cleanup }`. Call `cleanup()` in `afterEach`.
 */
export async function setupTestDbFile(): Promise<{
  conn: DbConnection;
  dbPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "both-db-"));
  const dbPath = join(dir, "test.duckdb");
  const conn = await getConnection(dbPath);
  await migrate(conn);
  return {
    conn,
    dbPath,
    cleanup: async () => {
      conn.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Create a ToolContext backed by a fresh in-memory database. */
export async function setupToolContext(): Promise<{
  conn: DbConnection;
  ctx: ToolContext;
}> {
  const conn = await setupTestDb();
  const ctx: ToolContext = {
    conn,
    dbPath: ":memory:",
    projectDir: "/tmp/test",
    config: { ...DEFAULT_CONFIG },
    mcpxClient: null,
  };
  return { conn, ctx };
}

/**
 * Seed a text file into context.
 * Accepts either `seedFile(conn, path, content)` — defaults to drive='agent' —
 * or `seedFile(conn, { drive, path }, content)` for an explicit drive.
 */
export async function seedFile(
  conn: DbConnection,
  ref: string | { drive: string; path: string },
  content: string,
  opts?: { title?: string; description?: string },
) {
  const { drive, path } =
    typeof ref === "string" ? { drive: "agent", path: ref } : ref;
  return createContextItem(conn, {
    title: opts?.title ?? path.split("/").pop() ?? path,
    description: opts?.description,
    content,
    drive,
    path,
    mimeType: "text/plain",
    isTextual: true,
  });
}

/** Seed a binary (non-textual) file. */
export async function seedBinaryFile(
  conn: DbConnection,
  ref: string | { drive: string; path: string },
) {
  const { drive, path } =
    typeof ref === "string" ? { drive: "agent", path: ref } : ref;
  return createContextItem(conn, {
    title: path.split("/").pop() ?? path,
    content: undefined,
    drive,
    path,
    mimeType: "application/octet-stream",
    isTextual: false,
  });
}

/** Seed a directory entry. */
export async function seedDir(
  conn: DbConnection,
  ref: string | { drive: string; path: string },
) {
  const { drive, path } =
    typeof ref === "string" ? { drive: "agent", path: ref } : ref;
  return createContextItem(conn, {
    title: path.split("/").pop() ?? path,
    drive,
    path,
    mimeType: "inode/directory",
    isTextual: false,
  });
}
