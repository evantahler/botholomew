import { generateText } from "ai";
import { resolveFastModel } from "../config/models.ts";
import type { BotholomewConfig, LlmBlock } from "../config/schemas.ts";
import {
  buildProviderOptions,
  formatLlmError,
  getLanguageModel,
  getMaxInputTokens,
} from "../llm/index.ts";
import { updateThreadTitle } from "../threads/store.ts";
import { logger } from "./logger.ts";

/**
 * Generate a short title for a thread using the configured fast model.
 * Fire-and-forget — errors are logged and never propagated.
 */
export async function generateThreadTitle(
  config: BotholomewConfig,
  projectDir: string,
  threadId: string,
  context: string,
): Promise<void> {
  // Declared out here so the catch can still name the provider in its
  // message when resolution itself is what failed.
  let llm: LlmBlock | undefined;
  try {
    llm = resolveFastModel(config).llm;
    const model = getLanguageModel(llm);
    const numCtx = await getMaxInputTokens(llm);

    const { text } = await generateText({
      model,
      maxOutputTokens: 50,
      system:
        "You are a title generator. The user will provide the first message from a conversation. Output a short descriptive title (5-8 words). Output ONLY the title, nothing else.",
      prompt: `Generate a title for this message:\n\n"${context}"`,
      providerOptions: buildProviderOptions(llm, numCtx),
    });

    const title = text.trim();
    if (title) {
      await updateThreadTitle(projectDir, threadId, title);
    }
  } catch (err) {
    logger.warn(`Failed to generate thread title: ${formatLlmError(err, llm)}`);
  }
}
