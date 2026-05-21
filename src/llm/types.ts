export type { LlmBlock, LlmProvider } from "../config/schemas.ts";

export interface CacheTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export class BotholomewLlmError extends Error {
  code: "no_tool_support" | "no_credentials" | "model_unreachable";
  constructor(
    code: "no_tool_support" | "no_credentials" | "model_unreachable",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "BotholomewLlmError";
  }
}
