import { loadFromEnvIfSet } from "../util/config";

export const configOpenAI = {
  apiKey: await loadFromEnvIfSet("OPENAI_API_KEY", "X"),
};
