export type Scope = "global" | "project";

export type LlmProvider = "anthropic" | "ollama" | "openai-compatible";

export interface LlmBlock {
  provider: LlmProvider;
  model: string;
  /** Base URL for the provider. Required for `openai-compatible`; optional for `ollama` (defaults to `http://localhost:11434`); ignored for `anthropic`. */
  base_url: string;
  api_key: string;
  /** Manual override for the model's max input tokens. `0` means "look it up". */
  max_input_tokens: number;
  /** Manual override for tool-calling support; only honored by `openai-compatible` (which has no portable capability probe). */
  supports_tools: boolean;
}

/**
 * Human-in-the-loop approval gate for outbound mcpx tool calls. The gate is
 * ON by default (`enabled: true`) and gates **every** mcpx tool — users opt
 * specific tools out via `allowed_tools`. A run launched with `--unsafe`
 * bypasses the gate entirely (see `buildApprovalPolicy` in `src/mcpx/client.ts`).
 */
export interface ApprovalConfig {
  /** Master switch. When false the gate is off (equivalent to running `--unsafe`). Default true. */
  enabled: boolean;
  /**
   * Opt-in allowlist of tools that run WITHOUT approval. Patterns match against
   * "server/tool": exact ("gmail/send_email"), wildcards on either side
   * ("gmail/" + star, or star + "/search"), or a "/regex/" tested against the
   * tool name. Empty (default) ⇒ gate everything.
   */
  allowed_tools: string[];
  /** Convenience: also skip the gate for tools the server annotates `readOnlyHint: true`. Default false. */
  auto_allow_read_only: boolean;
}

/** Name of the `models` entry that `init` seeds as the primary model. */
export const DEFAULT_MODEL_NAME = "default";
/** Name of the `models` entry that `init` seeds for cheap auxiliary calls. */
export const FAST_MODEL_NAME = "fast";

export interface BotholomewConfig {
  /**
   * Named model registry. Every entry is a self-contained `LlmBlock` — there is
   * no inheritance between entries, though keys omitted *within* an entry
   * backfill from `DEFAULT_LLM` at load time. Resolve entries through
   * `src/config/models.ts`, never by indexing this map directly.
   */
  models: Record<string, LlmBlock>;
  /** Entry in `models` used by chat and the worker agent loop when no `--model` / task `model:` overrides it. */
  default_model: string;
  /** Entry in `models` used for cheap auxiliary calls: thread titles, capability summaries, schedule evaluation. */
  fast_model: string;
  approvals: ApprovalConfig;
  embedding_model: string;
  embedding_dimension: number;
  tick_interval_seconds: number;
  max_tick_duration_seconds: number;
  system_prompt_override: string;
  max_turns: number;
  worker_heartbeat_interval_seconds: number;
  worker_dead_after_seconds: number;
  worker_reap_interval_seconds: number;
  worker_stopped_retention_seconds: number;
  schedule_min_interval_seconds: number;
  schedule_claim_stale_seconds: number;
  tui_idle_timeout_seconds: number;
  /** Default window (in hours) of recent threads the `dream` reflection reviews when `--since` is omitted. */
  dream_lookback_hours: number;
  log_level: string;
  membot_scope: Scope;
  mcpx_scope: Scope;
}

export const DEFAULT_LLM: LlmBlock = {
  provider: "anthropic",
  model: "claude-opus-4-6",
  base_url: "",
  api_key: "",
  max_input_tokens: 0,
  supports_tools: true,
};

/**
 * The registry `init` seeds and `loadConfig` falls back to when a config file
 * omits `models` entirely. Keys here are just names — users rename them, add
 * their own, and point `default_model` / `fast_model` wherever they like.
 */
export const DEFAULT_MODELS: Record<string, LlmBlock> = {
  [DEFAULT_MODEL_NAME]: DEFAULT_LLM,
  [FAST_MODEL_NAME]: { ...DEFAULT_LLM, model: "claude-haiku-4-5-20251001" },
};

export const DEFAULT_APPROVALS: ApprovalConfig = {
  enabled: true,
  allowed_tools: [],
  auto_allow_read_only: false,
};

export const DEFAULT_CONFIG: BotholomewConfig = {
  models: DEFAULT_MODELS,
  default_model: DEFAULT_MODEL_NAME,
  fast_model: FAST_MODEL_NAME,
  approvals: DEFAULT_APPROVALS,
  embedding_model: "Xenova/bge-small-en-v1.5",
  embedding_dimension: 384,
  tick_interval_seconds: 300,
  max_tick_duration_seconds: 120,
  system_prompt_override: "",
  max_turns: 0,
  worker_heartbeat_interval_seconds: 15,
  worker_dead_after_seconds: 60,
  worker_reap_interval_seconds: 30,
  worker_stopped_retention_seconds: 3600,
  schedule_min_interval_seconds: 60,
  schedule_claim_stale_seconds: 300,
  tui_idle_timeout_seconds: 180,
  dream_lookback_hours: 24,
  log_level: "",
  membot_scope: "global",
  mcpx_scope: "global",
};
