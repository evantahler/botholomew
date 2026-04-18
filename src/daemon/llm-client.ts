import Anthropic from "@anthropic-ai/sdk";
import type { BotholomewConfig } from "../config/schemas.ts";
import { createFakeAnthropicClient } from "./fake-llm.ts";

export function createLlmClient(config: BotholomewConfig): Anthropic {
  if (process.env.BOTHOLOMEW_FAKE_LLM === "1") {
    return createFakeAnthropicClient();
  }
  return new Anthropic({
    apiKey: config.anthropic_api_key || undefined,
  });
}
