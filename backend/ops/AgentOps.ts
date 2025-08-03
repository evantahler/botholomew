import { type Agent } from "../models/agent";
import { messages } from "../models/message";
import { api } from "../api";
import { Agent as OpenAIAgent, run } from "@openai/agents";

export function serializeAgent(agent: Agent) {
  return {
    id: agent.id,
    userId: agent.userId,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    contextSummary: agent.contextSummary,
    enabled: agent.enabled,
    schedule: agent.schedule,
    scheduleNextRun: agent.scheduleNextRun?.getTime(),
    scheduleLastRun: agent.scheduleLastRun?.getTime(),
    scheduleLastRunResult: agent.scheduleLastRunResult,
    scheduleLastRunError: agent.scheduleLastRunError,
    createdAt: agent.createdAt.getTime(),
    updatedAt: agent.updatedAt.getTime(),
  };
}

export async function agentTick(agent: Agent, limit: number = 25) {
  const _agent = new OpenAIAgent({
    name: agent.name,
    instructions: agent.systemPrompt,
    model: agent.model,
    tools: [],
  });

  const message = `Re-run per your instructions`;

  const result = await run(_agent, message);

  await api.db.db.insert(messages).values({
    agentId: agent.id,
    role: "user",
    content: message,
  });
  await api.db.db.insert(messages).values({
    agentId: agent.id,
    role: "assistant",
    content: result.finalOutput,
  });

  return { output: result.finalOutput };
}
