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

export interface BotholomewConfig {
  llm: LlmBlock;
  chunker_llm: LlmBlock;
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

export const DEFAULT_CHUNKER_LLM: LlmBlock = {
  ...DEFAULT_LLM,
  model: "claude-haiku-4-5-20251001",
};

export const DEFAULT_CONFIG: BotholomewConfig = {
  llm: DEFAULT_LLM,
  chunker_llm: DEFAULT_CHUNKER_LLM,
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
