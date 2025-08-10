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
      authorizeToolkitForUser: this.authorizeToolkitForUser,
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

    for (const toolkit of toolkits) {
      const toolkitTools = await api.arcade.client.tools.list({
        toolkit,
        limit,
      });
      const zodTools = toZod({
        tools: toolkitTools.items,
        client: api.arcade.client,
        userId: userId,
        // @ts-ignore
        executeFactory: executeOrAuthorizeZodToolWithLogging,
        // executeFactory: executeOrAuthorizeZodTool,
        // @ts-ignore
      }).map(tool);
      allTools.push(...zodTools);
    }

    return allTools;
  }

  async authorizeToolkitForUser(
    toolkit: string,
    userId: string,
    limit: number = 1000,
  ) {
    const tools = await api.arcade.client.tools.list({
      toolkit,
      limit,
    });

    const provider = tools.items[0].requirements?.authorization?.provider_id;
    if (!provider) throw new Error("No provider found for toolkit: " + toolkit);

    const scopes = [
      ...new Set(
        tools.items
          .map((tool) => tool.requirements?.authorization?.oauth2?.scopes ?? [])
          .flat(),
      ),
    ];

    const authResponse = await api.arcade.client.auth.start(userId, provider, {
      scopes: [...scopes],
    });

    if (authResponse.status !== "completed") {
      return authResponse.url;
    }
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

const executeOrAuthorizeZodToolWithLogging = (tool: any) => {
  return async (input: Arcade.Tools.ExecuteToolRequest) => {
    const toolExecutionId = Bun.randomUUIDv7().toString();
    const toolName = tool.toolDefinition.qualified_name as string;
    logger.info(
      ` [🛠️ ${toolExecutionId}] executing tool \`${toolName}\` (${JSON.stringify(input)})`,
    );
    const startTime = Date.now();
    try {
      const result = await executeOrAuthorizeZodTool(tool)(input);
      const endTime = Date.now();
      const duration = endTime - startTime;
      logger.info(
        ` [🛠️ ${toolExecutionId}] completed execution of tool \`${toolName}\` in ${duration}ms (${JSON.stringify(result)})`,
      );
      return result;
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const msg = ` [🛠️ ${toolExecutionId}] failed execution of tool \`${toolName}\` in ${duration}ms: ${error}`;
      logger.error(msg);
      throw error;
    }
  };
};
