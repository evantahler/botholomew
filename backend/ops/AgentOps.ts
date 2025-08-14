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
  return `You are a helpful assistant.
  You are able to use the following toolkits, and are an expert in the following services: ${agent.toolkits.join(", ")}.
  You MUST respond in the ${agent.responseType} format.  Do not include any other text in your response - only the response in the format specified.
  ` as const;
}

export async function agentTick(agent: Agent, agentRun: AgentRun) {
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

  const childAgents: OpenAIAgent[] = [];

  try {
    for (const toolkit of agent.toolkits) {
      const arcadeTools = await api.arcade.loadArcadeToolsForAgent(
        [toolkit],
        user.email,
      );

      const child = new OpenAIAgent({
        name: agent.name + " - " + toolkit,
        instructions: `
        You are an expert agent in the ${toolkit} toolkit.
        If you have been delegated to, you must use the tools provided to you.
        You must respond in the ${agent.responseType} format.  Do not include any other text in your response - only the response in the format specified.
        `,
        model: agent.model,
        tools: arcadeTools,
      });

      childAgents.push(child);
    }

    const parentAgent = new OpenAIAgent({
      name: agent.name + " (parent)",
      instructions:
        agent.systemPrompt +
        "\n\n---\n\n Additional information about the user: " +
        user.metadata,
      model: agent.model,
      tools: [],
      handoffs: childAgents,
    });

    const result = await run(parentAgent, agent.userPrompt);

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
