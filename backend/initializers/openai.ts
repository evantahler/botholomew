import { setDefaultOpenAIClient } from "@openai/agents";
import { config, RUN_MODE } from "../api";
import { Initializer } from "../classes/Initializer";
import OpenAI from "openai";

const namespace = "openai";

// Available agent model types
const AVAILABLE_AGENT_MODELS = [
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-4", label: "GPT-4" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
] as const;

export type AgentModel = (typeof AVAILABLE_AGENT_MODELS)[number];

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<OpenAIInitializer["initialize"]>>;
  }
}

export class OpenAIInitializer extends Initializer {
  constructor() {
    super(namespace);
    this.runModes = [RUN_MODE.SERVER];
  }

  async initialize() {
    const client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    setDefaultOpenAIClient(client);

    return {
      client,
      availableModels: AVAILABLE_AGENT_MODELS,
      getAvailableModels: () => AVAILABLE_AGENT_MODELS,
    };
  }

  async start() {}

  async stop() {}
}
