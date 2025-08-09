import { loadFromEnvIfSet } from "../util/config";

export const configArcade = {
  apiKey: await loadFromEnvIfSet("ARCADE_API_KEY", "x"),
  baseURL: (await loadFromEnvIfSet("ARCADE_BASE_URL", undefined)) as
    | string
    | undefined,
};
