import { getConfigPath } from "../constants.ts";
import { setLogLevel } from "../utils/logger.ts";
import { type BotholomewConfig, DEFAULT_CONFIG } from "./schemas.ts";

export async function loadConfig(
  projectDir: string,
): Promise<Required<BotholomewConfig>> {
  const configPath = getConfigPath(projectDir);
  const file = Bun.file(configPath);

  let userConfig: Partial<BotholomewConfig> = {};
  if (await file.exists()) {
    userConfig = JSON.parse(await file.text());
  }

  const config = { ...DEFAULT_CONFIG, ...userConfig };

  // env var overrides take precedence
  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic_api_key = process.env.ANTHROPIC_API_KEY;
  }

  setLogLevel(config.log_level);

  return config;
}

export async function saveConfig(
  projectDir: string,
  config: Partial<BotholomewConfig>,
): Promise<void> {
  const configPath = getConfigPath(projectDir);
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
