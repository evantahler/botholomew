import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MembotClient } from "membot";
import type { BotholomewConfig } from "../src/config/schemas.ts";
import { DEFAULT_CONFIG } from "../src/config/schemas.ts";
import { openMembot, sharedWithMem } from "../src/mem/client.ts";
import type { ToolContext } from "../src/tools/tool.ts";

// ---------------------------------------------------------------------------
// Mock helpers — Anthropic SDK
// ---------------------------------------------------------------------------

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

/** Mock Anthropic SDK module for `beta.models.retrieve()` tests. */
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
// Test config
// ---------------------------------------------------------------------------

export const TEST_CONFIG: Required<BotholomewConfig> = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
  // Force project-scoped membot in tests so per-tick / per-turn opens hit the
  // test's temp dir, not the developer's real `~/.membot` store.
  membot_scope: "project",
};

// ---------------------------------------------------------------------------
// Membot test fixtures
// ---------------------------------------------------------------------------

/**
 * Spin up a per-test membot store rooted at a fresh temp directory. The
 * caller gets a `MembotClient`, the project dir (suitable for passing as a
 * Botholomew `projectDir` to other code), and a `cleanup()` that closes the
 * client and removes the temp dir. Always call `cleanup()` in `afterEach`.
 */
export async function setupTestMembot(): Promise<{
  mem: MembotClient;
  projectDir: string;
  cleanup: () => Promise<void>;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), "both-mem-"));
  const mem = openMembot(projectDir);
  await mem.connect();
  return {
    mem,
    projectDir,
    cleanup: async () => {
      await mem.close();
      await rm(projectDir, { recursive: true, force: true });
    },
  };
}

/**
 * Build a fully-wired {@link ToolContext} backed by a fresh per-test membot
 * store. Use for tool-execution tests that need a real `withMem` accessor.
 * Cleanup tears down the underlying store.
 */
export async function setupToolContext(): Promise<{
  mem: MembotClient;
  projectDir: string;
  ctx: ToolContext;
  cleanup: () => Promise<void>;
}> {
  const { mem, projectDir, cleanup } = await setupTestMembot();
  const ctx: ToolContext = {
    withMem: sharedWithMem(mem),
    projectDir,
    config: { ...DEFAULT_CONFIG },
    mcpxClient: null,
  };
  return { mem, projectDir, ctx, cleanup };
}
