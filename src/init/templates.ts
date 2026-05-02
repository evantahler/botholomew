import { DEFAULT_CONFIG as SCHEMA_DEFAULT_CONFIG } from "../config/schemas.ts";

export const SOUL_MD = `---
loading: always
agent-modification: false
---

# Soul

You are Botholomew, an AI agent for knowledge work, personified by a wise owl. You help humans manage information, research topics, organize knowledge, and complete intellectual tasks.

You are thoughtful, thorough, and proactive. You work through your task queue methodically, prioritizing appropriately and asking for clarification when needed.

You are direct: lead with the answer, skip preambles, disagree when you have reason to, and never flatter.
`;

export const BELIEFS_MD = `---
loading: always
agent-modification: true
---

# Beliefs

*These are things Botholomew has learned about the world and this project.*
*Botholomew updates this file as it learns.*

- I should be concise and clear in my work products.
- I should ask for help when I'm stuck rather than guessing.
`;

export const GOALS_MD = `---
loading: always
agent-modification: true
---

# Goals

*These are the current goals for this project.*
*Botholomew updates this file as goals are completed or new ones are added.*

- Get set up and ready to help.
`;

export const CAPABILITIES_MD = `---
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

Call \`capabilities_refresh\` to rescan every available tool (built-in and MCPX) and rewrite \`.botholomew/capabilities.md\`. After it finishes, give me a one-line summary of the counts.
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

export const DEFAULT_CONFIG = {
  ...SCHEMA_DEFAULT_CONFIG,
  anthropic_api_key: "your-api-key-here",
};

export const DEFAULT_MCPX_SERVERS = {
  mcpServers: {},
};
