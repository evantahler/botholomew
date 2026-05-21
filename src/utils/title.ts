import { generateText } from "ai";
import type { BotholomewConfig } from "../config/schemas.ts";
import {
  buildProviderOptions,
  formatLlmError,
  getLanguageModel,
  getMaxInputTokens,
} from "../llm/index.ts";
import { updateThreadTitle } from "../threads/store.ts";
import { logger } from "./logger.ts";

/**
 * Generate a short title for a thread using the chunker model.
 * Fire-and-forget — errors are logged and never propagated.
 */
export async function generateThreadTitle(
  config: BotholomewConfig,
  projectDir: string,
  threadId: string,
  context: string,
): Promise<void> {
  try {
    const model = getLanguageModel(config.chunker_llm);
    const numCtx = await getMaxInputTokens(config.chunker_llm);

    const { text } = await generateText({
      model,
      maxOutputTokens: 50,
      system:
        "You are a title generator. The user will provide the first message from a conversation. Output a short descriptive title (5-8 words). Output ONLY the title, nothing else.",
      prompt: `Generate a title for this message:\n\n"${context}"`,
      providerOptions: buildProviderOptions(config.chunker_llm, numCtx),
    });

    const title = text.trim();
    if (title) {
      await updateThreadTitle(projectDir, threadId, title);
    }
  } catch (err) {
    logger.warn(
      `Failed to generate thread title: ${formatLlmError(err, config.chunker_llm)}`,
    );
  }
}
