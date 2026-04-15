import Anthropic from "@anthropic-ai/sdk";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { DbConnection } from "../db/connection.ts";
import { updateThreadTitle } from "../db/threads.ts";
import { logger } from "./logger.ts";

/**
 * Generate a short title for a thread using the chunker model (Haiku).
 * Fire-and-forget — errors are logged at debug level and never propagated.
 */
export async function generateThreadTitle(
  config: Required<BotholomewConfig>,
  conn: DbConnection,
  threadId: string,
  context: string,
): Promise<void> {
  try {
    const client = new Anthropic({
      apiKey: config.anthropic_api_key || undefined,
    });

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
      await updateThreadTitle(conn, threadId, title);
    }
  } catch (err) {
    logger.warn(`Failed to generate thread title: ${err}`);
  }
}
