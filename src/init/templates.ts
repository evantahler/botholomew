import {
  type BotholomewConfig,
  DEFAULT_MODEL_NAME,
  FAST_MODEL_NAME,
  type LlmProvider,
  DEFAULT_CONFIG as SCHEMA_DEFAULT_CONFIG,
  DEFAULT_LLM as SCHEMA_DEFAULT_LLM,
} from "../config/schemas.ts";

export const GOALS_MD = `---
title: Goals
loading: always
agent-modification: true
---

# Goals

You are Botholomew, an AI agent for knowledge work, personified by a wise owl. You help humans manage information, research topics, organize knowledge, and complete intellectual tasks.

You are thoughtful, thorough, and proactive. You work through your task queue methodically, prioritizing appropriately and asking for clarification when needed.

You are direct: lead with the answer, skip preambles, disagree when you have reason to, and never flatter.

*The list below is the current set of goals for this project. Update it as goals are completed or new ones are added.*

- Get set up and ready to help.
`;

export const BELIEFS_MD = `---
title: Beliefs
loading: always
agent-modification: true
---

# Beliefs

*These are things Botholomew has learned about the world and this project.*
*Botholomew updates this file as it learns.*

- I should be concise and clear in my work products.
- I should ask for help when I'm stuck rather than guessing.
`;

export const CAPABILITIES_MD = `---
title: Capabilities
loading: always
agent-modification: true
---

# Capabilities

*This file is an auto-generated inventory of every tool available to Botholomew — built-in tools and tools exposed via configured MCPX servers.*
*Regenerate with \`botholomew capabilities\`, the \`capabilities_refresh\` tool, or the \`/capabilities\` slash command.*

_(Pending first scan. Run \`botholomew capabilities\` to populate.)_
`;

export const CAPABILITIES_SKILL = `---
name: capabilities
description: "Refresh capabilities.md — rescan internal and MCPX tools"
arguments: []
---

Call \`capabilities_refresh\` to rescan every available tool (built-in and MCPX) and rewrite \`prompts/capabilities.md\`. After it finishes, give me a one-line summary of the counts.
`;

export const SUMMARIZE_SKILL = `---
name: summarize
description: "Summarize the current conversation"
arguments: []
---

Summarize this conversation so far. Provide a concise bullet-point summary
of what we discussed, any decisions made, and any open action items.
`;

export const STANDUP_SKILL = `---
name: standup
description: "Generate a standup update from recent tasks"
arguments: []
---

Generate a standup update. Look at recent tasks (completed in the last 24 hours
and currently in progress) and format a brief standup-style update with:
- What was done (completed tasks)
- What's in progress
- Any blockers or waiting items
`;

/**
 * Model ids seeded into the two named entries per provider. Both entries are
 * seeded with the *same* provider — `init --provider` picks one stack, and
 * mixing providers is a thing users do by hand afterwards.
 */
const PROVIDER_PRESETS: Record<LlmProvider, { default: string; fast: string }> =
  {
    anthropic: {
      default: "claude-opus-4-6",
      fast: "claude-haiku-4-5-20251001",
    },
    ollama: {
      default: "llama3.1:8b",
      fast: "qwen2.5:3b",
    },
    "openai-compatible": {
      default: "gpt-4o",
      fast: "gpt-4o-mini",
    },
  };

export function buildDefaultConfig(
  provider: LlmProvider = "anthropic",
): BotholomewConfig {
  const preset = PROVIDER_PRESETS[provider];
  const apiKeyPlaceholder = provider === "anthropic" ? "your-api-key-here" : "";
  const baseUrl = provider === "ollama" ? "http://localhost:11434" : "";
  const entry = (model: string) => ({
    ...SCHEMA_DEFAULT_LLM,
    provider,
    model,
    base_url: baseUrl,
    api_key: apiKeyPlaceholder,
  });
  return {
    ...SCHEMA_DEFAULT_CONFIG,
    models: {
      [DEFAULT_MODEL_NAME]: entry(preset.default),
      [FAST_MODEL_NAME]: entry(preset.fast),
    },
    default_model: DEFAULT_MODEL_NAME,
    fast_model: FAST_MODEL_NAME,
  };
}

export const DEFAULT_CONFIG = buildDefaultConfig("anthropic");

export const DEFAULT_MCPX_SERVERS = {
  mcpServers: {},
};
