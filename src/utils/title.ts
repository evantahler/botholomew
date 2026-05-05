import type { BotholomewConfig } from "../config/schemas.ts";
import { updateThreadTitle } from "../threads/store.ts";
import { createLlmClient } from "../worker/llm-client.ts";
import { logger } from "./logger.ts";

/**
 * Generate a short title for a thread using the chunker model (Haiku).
 * Fire-and-forget — errors are logged and never propagated. Writes the
 * title back to the thread's CSV file by rewriting the thread_meta row.
 */
export async function generateThreadTitle(
  config: Required<BotholomewConfig>,
  projectDir: string,
  threadId: string,
  context: string,
): Promise<void> {
  try {
    const client = createLlmClient(config);

    const response = await client.messages.create({
      model: config.chunker_model,
      max_tokens: 50,
      system:
        "You are a title generator. The user will provide the first message from a conversation. Output a short descriptive title (5-8 words). Output ONLY the title, nothing else.",
      messages: [
        {
          role: "user",
          content: `Generate a title for this message:\n\n"${context}"`,
        },
      ],
    });

    const title = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (title) {
      await updateThreadTitle(projectDir, threadId, title);
    }
  } catch (err) {
    logger.warn(`Failed to generate thread title: ${err}`);
  }
}
