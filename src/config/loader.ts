import { lstat, readlink, stat } from "node:fs/promises";
import { getConfigPath } from "../constants.ts";
import { setLogLevel } from "../utils/logger.ts";
import {
  type BotholomewConfig,
  DEFAULT_APPROVALS,
  DEFAULT_CONFIG,
  DEFAULT_LLM,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODELS,
  FAST_MODEL_NAME,
  type LlmBlock,
} from "./schemas.ts";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};

/**
 * The on-disk shape. `DeepPartial` only descends one level, so it would type
 * `models` as `Partial<Record<string, LlmBlock>>` — optional *values*, but each
 * one a whole `LlmBlock`. Users write partial entries, so override that key.
 */
type RawConfig = Omit<DeepPartial<BotholomewConfig>, "models"> & {
  models?: Record<string, Partial<LlmBlock>>;
};

function mergeLlmBlock(
  defaults: LlmBlock,
  override: Partial<LlmBlock> | undefined,
): LlmBlock {
  return { ...defaults, ...(override ?? {}) };
}

/**
 * Backfill each named model entry from `DEFAULT_LLM` so a hand-written config
 * can name just a `provider` + `model` and still get sane values for
 * `max_input_tokens` / `supports_tools`. Entries never inherit from each other
 * — only from the schema defaults.
 *
 * Typed against `Record<string, Partial<LlmBlock>>` rather than the `DeepPartial`
 * mapped type, which only descends one level and would type the values as whole
 * `LlmBlock`s.
 */
function mergeModels(
  userModels: Record<string, Partial<LlmBlock>> | undefined,
): Record<string, LlmBlock> {
  const entries = Object.entries(userModels ?? {});
  if (entries.length === 0) return { ...DEFAULT_MODELS };
  return Object.fromEntries(
    entries.map(([name, block]) => [name, mergeLlmBlock(DEFAULT_LLM, block)]),
  );
}

/**
 * The `llm` / `chunker_llm` blocks were replaced by the `models` registry.
 * This is *not* back-compat translation — it's a loud failure. Without it a
 * pre-existing config silently falls back to `DEFAULT_MODELS`, so a user who
 * had `llm.model` pointed somewhere else would quietly run a different model
 * and read it as "my old key was honored".
 */
function assertNoLegacyModelKeys(raw: Record<string, unknown>): void {
  const legacy = ["llm", "chunker_llm"].filter((k) => k in raw);
  if (legacy.length === 0) return;
  throw new Error(
    `config.json uses the removed ${legacy.map((k) => `"${k}"`).join(" and ")} ` +
      `key${legacy.length > 1 ? "s" : ""}. Models are now a named registry:\n\n` +
      `  "models": {\n` +
      `    "default": { "provider": "anthropic", "model": "claude-opus-4-6", "api_key": "…" },\n` +
      `    "fast":    { "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "api_key": "…" }\n` +
      `  },\n` +
      `  "default_model": "default",\n` +
      `  "fast_model": "fast"\n\n` +
      `Move each old block into an entry under "models" and delete the old key.`,
  );
}

/**
 * Pick `default_model` when the user defined `models` but didn't say which one
 * is the default. Writing a single-entry registry and expecting it to be used
 * is the obvious reading, so don't make people restate it.
 */
function pickDefaultModel(
  models: Record<string, LlmBlock>,
  explicit: string | undefined,
): string {
  if (explicit) return explicit;
  if (models[DEFAULT_MODEL_NAME]) return DEFAULT_MODEL_NAME;
  const names = Object.keys(models);
  if (names.length === 1 && names[0]) return names[0];
  throw new Error(
    `config.json defines ${names.length} models (${names.sort().join(", ")}) ` +
      `but no "default_model". Add \`"default_model": "<name>"\` to pick one.`,
  );
}

/**
 * `fast_model` is an optimization, not a requirement — if the user never named
 * one, run the cheap auxiliary calls on the default model rather than erroring.
 */
function pickFastModel(
  models: Record<string, LlmBlock>,
  explicit: string | undefined,
  defaultModel: string,
): string {
  if (explicit) return explicit;
  if (models[FAST_MODEL_NAME]) return FAST_MODEL_NAME;
  return defaultModel;
}

/**
 * Fail at load rather than mid-stream: a `default_model` / `fast_model` naming
 * a missing entry is a config typo, and this is the only validation the config
 * gets (it's plain interfaces + a shallow merge, no Zod).
 */
function assertModelPointers(config: BotholomewConfig): void {
  const available = Object.keys(config.models).sort();
  const list = available.length > 0 ? available.join(", ") : "(none)";
  if (available.length === 0) {
    throw new Error(
      'config.json: "models" is empty. Define at least one named model entry.',
    );
  }
  for (const key of ["default_model", "fast_model"] as const) {
    const name = config[key];
    if (!config.models[name]) {
      throw new Error(
        `config.json: "${key}" is "${name}", which is not a key of "models". ` +
          `Configured models: ${list}.`,
      );
    }
  }
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
    models: Object.fromEntries(
      Object.entries(config.models).map(([name, block]) => [
        name,
        applyTo(block),
      ]),
    ),
  };
}

export async function loadConfig(
  projectDir: string,
): Promise<BotholomewConfig> {
  const configPath = getConfigPath(projectDir);

  await assertNotDanglingSymlink(configPath);

  const file = Bun.file(configPath);

  let userConfig: RawConfig = {};
  if (await file.exists()) {
    const raw = JSON.parse(await file.text()) as Record<string, unknown>;
    assertNoLegacyModelKeys(raw);
    userConfig = raw as RawConfig;
  }

  const models = mergeModels(userConfig.models);
  const defaultModel = pickDefaultModel(models, userConfig.default_model);

  const merged: BotholomewConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    models,
    default_model: defaultModel,
    fast_model: pickFastModel(models, userConfig.fast_model, defaultModel),
    // Deep-merge so a config predating the approval gate (or only overriding
    // one key) still gets the safe defaults — and back-compat keeps the gate ON.
    approvals: { ...DEFAULT_APPROVALS, ...(userConfig.approvals ?? {}) },
  };

  const config = applyEnvOverrides(merged);

  assertModelPointers(config);

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
  config: RawConfig,
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
