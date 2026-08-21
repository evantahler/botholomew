import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MembotClient } from "membot";
import type { BotholomewConfig, LlmBlock } from "../src/config/schemas.ts";
import {
  DEFAULT_CONFIG,
  DEFAULT_LLM,
  DEFAULT_MODEL_NAME,
  FAST_MODEL_NAME,
} from "../src/config/schemas.ts";
import { openMembot, sharedWithMem } from "../src/mem/client.ts";
import type { ToolContext } from "../src/tools/tool.ts";

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

/** A credentialed `LlmBlock`, for call sites that now take a resolved model. */
export const TEST_LLM: LlmBlock = { ...DEFAULT_LLM, api_key: "test-key" };

export const TEST_CONFIG: BotholomewConfig = {
  ...DEFAULT_CONFIG,
  models: {
    [DEFAULT_MODEL_NAME]: TEST_LLM,
    [FAST_MODEL_NAME]: {
      ...DEFAULT_LLM,
      model: DEFAULT_CONFIG.models[FAST_MODEL_NAME]?.model ?? DEFAULT_LLM.model,
      api_key: "test-key",
    },
  },
  // Force project-scoped membot in tests so per-tick / per-turn opens hit the
  // test's temp dir, not the developer's real `~/.membot` store.
  membot_scope: "project",
};

// ---------------------------------------------------------------------------
// Membot test fixtures
// ---------------------------------------------------------------------------

/**
 * Spin up a per-test membot store rooted at a fresh temp directory.
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
 * Build a fully-wired {@link ToolContext} backed by a fresh per-test membot store.
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
    config: { ...TEST_CONFIG },
    mcpxClient: null,
  };
  return { mem, projectDir, ctx, cleanup };
}
