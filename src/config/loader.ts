import { getConfigPath } from "../constants.ts";
import { setLogLevel } from "../utils/logger.ts";
import {
  type BotholomewConfig,
  DEFAULT_CHUNKER_LLM,
  DEFAULT_CONFIG,
  DEFAULT_LLM,
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
  };

  const config = applyEnvOverrides(merged);

  setLogLevel(config.log_level);

  return config;
}

export async function saveConfig(
  projectDir: string,
  config: DeepPartial<BotholomewConfig>,
): Promise<void> {
  const configPath = getConfigPath(projectDir);
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
