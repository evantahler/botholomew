import { setDefaultOpenAIClient } from "@openai/agents";
import { config, RUN_MODE } from "../api";
import { Initializer } from "../classes/Initializer";
import OpenAI from "openai";

const namespace = "openai";

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

    return { client };
  }

  async start() {}

  async stop() {}
}
