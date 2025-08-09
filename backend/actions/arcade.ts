import { z } from "zod";
import { api, Action, type ActionParams, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { SessionMiddleware } from "../middleware/session";

export class ArcadeListToolkits implements Action {
  name = "arcade:list-toolkits";
  description = "List available Arcade toolkits";
  web = { route: "/arcade/toolkits", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    limit: z.number().optional().default(1000),
  });

  async run(params: ActionParams<ArcadeListToolkits>, connection: Connection) {
    const toolkits = await api.arcade.getAvailableToolkits(params.limit);
    return { toolkits };
  }
}
