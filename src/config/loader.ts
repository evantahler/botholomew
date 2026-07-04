import { lstat, readlink, stat } from "node:fs/promises";
import { getConfigPath } from "../constants.ts";
import { setLogLevel } from "../utils/logger.ts";
import {
  type BotholomewConfig,
  DEFAULT_APPROVALS,
  DEFAULT_CHUNKER_LLM,
  DEFAULT_CONFIG,
  DEFAULT_LLM,
  DEFAULT_NOTIFY,
  type LlmBlock,
} from "./schemas.ts";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};

function mergeLlmBlock(
  defaults: LlmBlock,
  override: Partial<LlmBlock> | undefined,
): LlmBlock {
  return { ...defaults, ...(override ?? {}) };
}

function applyEnvOverrides(config: BotholomewConfig): BotholomewConfig {
  const applyTo = (block: LlmBlock): LlmBlock => {
    const next = { ...block };
    if (next.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      next.api_key = process.env.ANTHROPIC_API_KEY;
    }
    if (next.provider === "openai-compatible" && process.env.OPENAI_API_KEY) {
      if (!next.api_key) next.api_key = process.env.OPENAI_API_KEY;
    }
    if (next.provider === "ollama" && process.env.OLLAMA_HOST) {
      if (!next.base_url) next.base_url = process.env.OLLAMA_HOST;
    }
    return next;
  };
  return {
    ...config,
    llm: applyTo(config.llm),
    chunker_llm: applyTo(config.chunker_llm),
  };
}

export async function loadConfig(
  projectDir: string,
): Promise<BotholomewConfig> {
  const configPath = getConfigPath(projectDir);

  await assertNotDanglingSymlink(configPath);

  const file = Bun.file(configPath);

  let userConfig: DeepPartial<BotholomewConfig> = {};
  if (await file.exists()) {
    userConfig = JSON.parse(await file.text()) as DeepPartial<BotholomewConfig>;
  }

  const merged: BotholomewConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    llm: mergeLlmBlock(DEFAULT_LLM, userConfig.llm),
    chunker_llm: mergeLlmBlock(DEFAULT_CHUNKER_LLM, userConfig.chunker_llm),
    // Deep-merge so a config predating the approval gate (or only overriding
    // one key) still gets the safe defaults — and back-compat keeps the gate ON.
    approvals: { ...DEFAULT_APPROVALS, ...(userConfig.approvals ?? {}) },
    // Same deep-merge: an older config (or one that only flips `enabled`) still
    // gets the default channels/events. `channels` replaces wholesale (like
    // `allowed_tools`); `events` is merged key-by-key so a partial override
    // keeps the untouched toggles on.
    notify: {
      ...DEFAULT_NOTIFY,
      ...(userConfig.notify ?? {}),
      events: {
        ...DEFAULT_NOTIFY.events,
        ...(userConfig.notify?.events ?? {}),
      },
    },
  };

  const config = applyEnvOverrides(merged);

  setLogLevel(config.log_level);

  return config;
}

async function assertNotDanglingSymlink(configPath: string): Promise<void> {
  let lst: Awaited<ReturnType<typeof lstat>>;
  try {
    lst = await lstat(configPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (!lst.isSymbolicLink()) return;
  try {
    await stat(configPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const target = await readlink(configPath).catch(() => "<unreadable>");
      throw new Error(
        `Config file is a symlink to a missing target: ${configPath} -> ${target}. ` +
          `Symlink targets are resolved relative to the symlink's own directory, ` +
          `not the current working directory — use an absolute path or a target ` +
          `relative to ${configPath.replace(/\/[^/]+$/, "")}.`,
      );
    }
    throw err;
  }
}

export async function saveConfig(
  projectDir: string,
  config: DeepPartial<BotholomewConfig>,
): Promise<void> {
  const configPath = getConfigPath(projectDir);
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Append an mcpx tool pattern to `approvals.allowed_tools` on disk, preserving
 * every other key in the file (a surgical merge, not a full rewrite of merged
 * defaults). Used by the chat TUI's "always allow" decision. No-op if the
 * pattern is already present.
 */
export async function addAllowedTool(
  projectDir: string,
  pattern: string,
): Promise<void> {
  const configPath = getConfigPath(projectDir);
  const file = Bun.file(configPath);
  const raw: Record<string, unknown> = (await file.exists())
    ? JSON.parse(await file.text())
    : {};
  if (!raw.approvals || typeof raw.approvals !== "object") raw.approvals = {};
  const approvals = raw.approvals as Record<string, unknown>;
  if (!Array.isArray(approvals.allowed_tools)) approvals.allowed_tools = [];
  const allowed = approvals.allowed_tools as string[];
  if (!allowed.includes(pattern)) allowed.push(pattern);
  await Bun.write(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}
