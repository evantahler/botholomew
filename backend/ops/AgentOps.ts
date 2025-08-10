import { type Agent } from "../models/agent";
import { agent_run, AgentRun } from "../models/agent_run";
import { api } from "../api";
import { Agent as OpenAIAgent, run } from "@openai/agents";
import { User, users } from "../models/user";
import { eq } from "drizzle-orm";
import { ErrorType, TypedError } from "../classes/TypedError";
import { getUnauthorizedToolkits } from "./ToolkitAuthorizationOps";

export function serializeAgent(agent: Agent) {
  return {
    id: agent.id,
    userId: agent.userId,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    userPrompt: agent.userPrompt,
    responseType: agent.responseType,
    enabled: agent.enabled,
    schedule: agent.schedule,
    scheduleNextRun: agent.scheduleNextRun?.getTime(),
    scheduleLastRun: agent.scheduleLastRun?.getTime(),
    scheduleLastRunResult: agent.scheduleLastRunResult,
    scheduleLastRunError: agent.scheduleLastRunError,
    toolkits: agent.toolkits,
    createdAt: agent.createdAt.getTime(),
    updatedAt: agent.updatedAt.getTime(),
  };
}

export function getSystemPrompt(agent: Agent) {
  return `
  You are a helpful assistant.
  You are able to use the following toolkits: ${agent.toolkits.join(", ")}.
  You MUST respond in the ${agent.responseType} format.` as const;
}

export async function agentTick(agent: Agent) {
  const [user]: User[] = await api.db.db
    .select()
    .from(users)
    .where(eq(users.id, agent.userId))
    .limit(1);

  if (!user) {
    throw new TypedError({
      message: "User not found",
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
    });
  }

  // Check toolkit authorization before running the agent
  if (agent.toolkits && agent.toolkits.length > 0) {
    const unauthorizedToolkits = await getUnauthorizedToolkits(
      user.id,
      agent.toolkits,
    );

    if (unauthorizedToolkits.length > 0) {
      throw new TypedError({
        message: `Agent cannot run because you are not authorized to use the following toolkits: ${unauthorizedToolkits.join(", ")}. Please authorize these toolkits or remove them from the agent.`,
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }
  }

  const arcadeTools = await api.arcade.loadArcadeToolsForAgent(
    agent.toolkits,
    user.email,
  );

  const [agentRun]: AgentRun[] = await api.db.db
    .insert(agent_run)
    .values({
      agentId: agent.id,
      systemPrompt: agent.systemPrompt,
      userMessage: agent.userPrompt,
      response: null,
      type: agent.responseType,
      status: "pending",
    })
    .returning();

  try {
    const openAiAgent = new OpenAIAgent({
      name: agent.name,
      instructions: agent.systemPrompt,
      model: agent.model,
      tools: arcadeTools,
    });

    const result = await run(openAiAgent, agent.userPrompt);

    await api.db.db
      .update(agent_run)
      .set({
        response: result.finalOutput ?? null,
        status: "completed",
      })
      .where(eq(agent_run.id, agentRun.id));
  } catch (error) {
    await api.db.db
      .update(agent_run)
      .set({
        response: String(error) ?? null,
        status: "failed",
      })
      .where(eq(agent_run.id, agentRun.id));
  }

  // reload agentRun
  const [reloadedAgentRun]: AgentRun[] = await api.db.db
    .select()
    .from(agent_run)
    .where(eq(agent_run.id, agentRun.id))
    .limit(1);

  return reloadedAgentRun;
}
