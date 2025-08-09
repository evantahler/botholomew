import { Arcade } from "@arcadeai/arcadejs";
import { toZod, executeOrAuthorizeZodTool } from "@arcadeai/arcadejs/lib";
import { config, RUN_MODE, api } from "../api";
import { Initializer } from "../classes/Initializer";
import { logger } from "../api";
import { tool } from "@openai/agents";

const namespace = "arcade";

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<ArcadeInitializer["initialize"]>>;
  }
}

export class ArcadeInitializer extends Initializer {
  constructor() {
    super(namespace);
    this.runModes = [RUN_MODE.SERVER];
  }

  async initialize() {
    const client = new Arcade({
      apiKey: config.arcade.apiKey,
      baseURL: config.arcade.baseURL,
    });

    logger.info(
      `Arcade client initialized successfully @ ${config.arcade.baseURL}`,
    );
    return {
      client,
      loadArcadeToolsForAgent: this.loadArcadeToolsForAgent,
      getAvailableToolkits: this.getAvailableToolkits,
    };
  }

  async start() {}

  async stop() {}

  async loadArcadeToolsForAgent(
    toolkits: string[],
    userId: string,
    limit: number = 999,
  ): Promise<any[]> {
    const allTools: any[] = [];

    // Load tools from each toolkit
    for (const toolkit of toolkits) {
      const toolkitTools = await api.arcade.client.tools.list({
        toolkit,
        limit,
      });
      const zodTools = toZod({
        tools: toolkitTools.items,
        client: api.arcade.client,
        userId: userId,
        executeFactory: executeOrAuthorizeZodTool,
      }).map(tool);
      allTools.push(...zodTools);
    }

    return allTools;
  }

  async getAvailableToolkits(limit: number = 1000) {
    const tools = await api.arcade.client.tools.list({ limit });

    const response = [] as {
      name: string;
      description: string;
      tools: string[];
    }[];

    for (const tool of tools.items) {
      let existingToolkit = response.find((t) => t.name === tool.toolkit.name);

      if (!existingToolkit) {
        existingToolkit = {
          name: tool.toolkit.name,
          description: tool.toolkit.description ?? "",
          tools: [],
        };
        response.push(existingToolkit);
      }

      existingToolkit!.tools.push(tool.name);
    }

    return response;
  }
}
