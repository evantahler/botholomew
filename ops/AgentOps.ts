import { agents, type Agent, type NewAgent } from "../models/agent";
import { Message, messages } from "../models/message";
import { desc, eq } from "drizzle-orm";
import { api } from "../api";
import {
  AgentInputItem,
  Agent as OpenAIAgent,
  run as OpenAiAgentRun,
} from "@openai/agents";

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

export function toAgentInputItem(message: Message): AgentInputItem {
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content,
      type: "message",
    };
  } else if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: message.content,
        },
      ],
      type: "message",
      status: "completed",
    };
  } else {
    return {
      role: "system",
      content: message.content,
      type: "message",
    };
  }
}

export async function agentTick(agent: Agent) {
  try {
    const _messages: Message[] = await api.db.db
      .select()
      .from(messages)
      .where(eq(messages.agentId, agent.id))
      .limit(10)
      .orderBy(desc(messages.createdAt));

    const _agent = new OpenAIAgent({
      name: agent.name,
      instructions: agent.systemPrompt,
      model: agent.model,
      tools: [],
    });

    let thread: AgentInputItem[] = _messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(toAgentInputItem);

    thread.push({
      role: "system",
      content: `You are an agent named \`${agent.name}\` and described as:\n    ${agent.description}`,
    });

    const result = await OpenAiAgentRun(_agent, thread);

    // Always extract a string from result.output, handling array, string, and object cases
    const outputText = Array.isArray(result.output)
      ? (result.output as any[])
          .map((item) => {
            if (typeof item === "string") return item;
            if (
              item &&
              typeof item === "object" &&
              "text" in item &&
              typeof item.text === "string"
            )
              return item.text;
            if (
              item &&
              typeof item === "object" &&
              "content" in item &&
              typeof item.content === "string"
            )
              return item.content;
            return JSON.stringify(item);
          })
          .join("\n")
      : typeof result.output === "string"
        ? result.output
        : (result.output &&
            typeof result.output === "object" &&
            "text" in result.output &&
            typeof (result.output as any).text === "string" &&
            (result.output as any).text) ||
          (result.output &&
            typeof result.output === "object" &&
            "content" in result.output &&
            typeof (result.output as any).content === "string" &&
            (result.output as any).content) ||
          JSON.stringify(result.output);

    await api.db.db.insert(messages).values({
      agentId: agent.id,
      role: "assistant",
      content: outputText,
    });

    return { output: outputText };
  } catch (error) {
    console.error("Error in agentTick:", error);

    // Create a fallback response
    const fallbackResponse =
      "I apologize, but I encountered an error while processing your request. Please try again.  The error was: " +
      error;

    await api.db.db.insert(messages).values({
      agentId: agent.id,
      role: "assistant",
      content: fallbackResponse,
    });

    return { output: fallbackResponse };
  }
}
