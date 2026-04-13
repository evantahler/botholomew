export interface BotholomewConfig {
  anthropic_api_key?: string;
  model?: string;
  chunker_model?: string;
  tick_interval_seconds?: number;
  max_tick_duration_seconds?: number;
  system_prompt_override?: string;
}

export const DEFAULT_CONFIG: Required<BotholomewConfig> = {
  anthropic_api_key: "",
  model: "claude-opus-4-20250514",
  chunker_model: "claude-haiku-4-20250514",
  tick_interval_seconds: 300,
  max_tick_duration_seconds: 120,
  system_prompt_override: "",
};
