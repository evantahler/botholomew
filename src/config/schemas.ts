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

/**
 * A single outbound notification destination. `desktop` shells out to the OS
 * (macOS `terminal-notifier`/`osascript`, Linux `notify-send`); `mcpx` delivers
 * through a configured mcpx tool (Slack, email, …). mcpx notify calls bypass the
 * approval gate — a target listed here is pre-approved by virtue of being config
 * — but each dispatch is still logged.
 */
export type NotifyChannel =
  | { type: "desktop" }
  | {
      type: "mcpx";
      /** mcpx server name (as in `servers.json`). */
      server: string;
      /** Tool on that server to invoke, e.g. `send_dm_to_user`. */
      tool: string;
      /**
       * Args passed to the tool. String values may contain `{{title}}`,
       * `{{message}}`, and `{{severity}}` placeholders, substituted per-call.
       */
      args: Record<string, unknown>;
    };

/** Worker events that can auto-notify without the LLM asking. */
export interface NotifyEvents {
  /** A task ended in `failed` (prompt-load error, agent loop threw, etc.). */
  task_failed: boolean;
  /**
   * A task file was quarantined (malformed frontmatter). Reserved — the config
   * key exists and defaults on, but worker wiring lands in a follow-up.
   */
  task_quarantined: boolean;
  /** A schedule threw while being evaluated. */
  schedule_errored: boolean;
}

/**
 * Outbound notifications: a first-class way for workers (and the chat agent) to
 * reach the user. `notify` is a pure dispatcher — it fans a message out to the
 * configured channels, which own their own inboxes. There is no local store.
 */
export interface NotifyConfig {
  /** Master switch. When false, `notify` is a no-op. Default true. */
  enabled: boolean;
  /** Ordered list of destinations. Default `[{ type: "desktop" }]`. */
  channels: NotifyChannel[];
  /** Which worker events auto-notify (each individually toggleable). */
  events: NotifyEvents;
}

export interface BotholomewConfig {
  llm: LlmBlock;
  chunker_llm: LlmBlock;
  approvals: ApprovalConfig;
  notify: NotifyConfig;
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

export const DEFAULT_APPROVALS: ApprovalConfig = {
  enabled: true,
  allowed_tools: [],
  auto_allow_read_only: false,
};

export const DEFAULT_NOTIFY: NotifyConfig = {
  enabled: true,
  channels: [{ type: "desktop" }],
  events: {
    task_failed: true,
    task_quarantined: true,
    schedule_errored: true,
  },
};

export const DEFAULT_CONFIG: BotholomewConfig = {
  llm: DEFAULT_LLM,
  chunker_llm: DEFAULT_CHUNKER_LLM,
  approvals: DEFAULT_APPROVALS,
  notify: DEFAULT_NOTIFY,
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
