export interface BotholomewConfig {
  anthropic_api_key?: string;
  model?: string;
  chunker_model?: string;
  embedding_model?: string;
  embedding_dimension?: number;
  tick_interval_seconds?: number;
  max_tick_duration_seconds?: number;
  system_prompt_override?: string;
  max_turns?: number;
  worker_heartbeat_interval_seconds?: number;
  worker_dead_after_seconds?: number;
  worker_reap_interval_seconds?: number;
  worker_stopped_retention_seconds?: number;
  schedule_min_interval_seconds?: number;
  schedule_claim_stale_seconds?: number;
  log_level?: string;
}

export const DEFAULT_CONFIG: Required<BotholomewConfig> = {
  anthropic_api_key: "",
  model: "claude-opus-4-6",
  chunker_model: "claude-haiku-4-5-20251001",
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
  log_level: "",
};
