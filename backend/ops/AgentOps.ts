import { Agent as OpenAIAgent, run } from "@openai/agents";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { api } from "../api";
import { ErrorType, TypedError } from "../classes/TypedError";
import { type Agent } from "../models/agent";
import { User, users } from "../models/user";
import {
  workflow_run_steps,
  WorkflowRunStep,
} from "../models/workflow_run_step";
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
    toolkits: agent.toolkits,
    createdAt: agent.createdAt.getTime(),
    updatedAt: agent.updatedAt.getTime(),
  };
}

export function getSystemPrompt(agent: Agent) {
  return `
You are a helpful assistant which runs without human intervention.
${agent.toolkits.length > 0 ? `You are able to use the following services via tools: ${agent.toolkits.join(", ")}.  You should STRONGLY PREFER to use the tools provided to you.` : ""}
You MUST respond in the ${agent.responseType} format.
Do not include any other text in your response - only the single response in the ${agent.responseType} format.
  `.trim();
}

export class AgentRunResult {
  status: (typeof workflow_run_steps.$inferSelect)["status"] = "pending";
  result: string | undefined;
  error: string | undefined;
  rationale: string | undefined;
  workflowRunStep: WorkflowRunStep | undefined;

  async judgeStatus(instructions: string) {
    const judgeAgent = new OpenAIAgent({
      name: "AgentRunResult - Judge",
      instructions: `
      You are given a result from an agent's run and instructions.
      You must judge if the result successfully completed the instructions or not.
      The result was not successful if it was empty or missing an argument, or if it was an error.
      `,
      model: "gpt-4o",
      outputType: z.object({
        success: z.boolean().describe("Was the result successful?"),
        rationale: z
          .string()
          .describe(
            "Why was this result considered successful? Briefly explain why.",
          ),
      }),
    });

    const question = `
    Your original instructions where:
    <ORIGINAL_INSTRUCTIONS>
    ${instructions}
    </ORIGINAL_INSTRUCTIONS>
    The result of the agent's previous run was:
    <RESULT>
    ${this.result ? this.result : "No result provided"}
    </RESULT>
    ${
      this.error
        ? `The error was: <ERROR>\n${this.error}\n</ERROR>`
        : "No error was provided"
    }
    Was this result successful?
    `;

    const result = await run(judgeAgent, question);

    return result;
  }
}

export async function agentRun(
  agent: Agent,
  workflowRunStep: WorkflowRunStep | undefined = undefined,
  additionalContext: string | undefined = undefined,
): Promise<AgentRunResult> {
  const runResult = new AgentRunResult();

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

    const instructions =
      agent.systemPrompt +
      "\n\n---\n\n Additional information about the user: \r\n" +
      user.metadata +
      (additionalContext
        ? "\n\n---\n\n Additional context: \r\n" + additionalContext
        : "");

    const parentAgent = new OpenAIAgent({
      name: agent.name + " (parent)",
      instructions,
      model: agent.model,
      tools: [],
      handoffs: childAgents,
    });

    const result = await run(parentAgent, agent.userPrompt);
    runResult.result = result.finalOutput;
    runResult.status = (await runResult.judgeStatus(instructions))?.finalOutput
      ?.success
      ? "completed"
      : "failed";

    if (workflowRunStep) {
      await api.db.db
        .update(workflow_run_steps)
        .set({
          outout: runResult.result,
          status: runResult.status,
        })
        .where(eq(workflow_run_steps.id, workflowRunStep.id));
    }
  } catch (error) {
    runResult.error = String(error);
    runResult.status = "failed";
    if (workflowRunStep) {
      await api.db.db
        .update(workflow_run_steps)
        .set({
          outout: runResult.error,
          status: runResult.status,
        })
        .where(eq(workflow_run_steps.id, workflowRunStep.id));
    }
  }

  // reload agentRun
  if (workflowRunStep) {
    const [reloadedWorkflowRunStep]: WorkflowRunStep[] = await api.db.db
      .select()
      .from(workflow_run_steps)
      .where(eq(workflow_run_steps.id, workflowRunStep.id))
      .limit(1);

    runResult.workflowRunStep = reloadedWorkflowRunStep;
  }

  return runResult;
}
