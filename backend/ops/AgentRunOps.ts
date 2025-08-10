import { type AgentRun } from "../models/agent_run";

export function serializeAgentRun(run: AgentRun) {
  return {
    id: run.id,
    agentId: run.agentId,
    systemPrompt: run.systemPrompt,
    userMessage: run.userMessage,
    response: run.response,
    type: run.type,
    status: run.status,
    createdAt: run.createdAt.getTime(),
    updatedAt: run.updatedAt.getTime(),
  };
}
