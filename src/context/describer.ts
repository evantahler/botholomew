import Anthropic from "@anthropic-ai/sdk";
import type { BotholomewConfig } from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";

const DESCRIBE_TOOL_NAME = "return_description";
const DESCRIBE_TOOL = {
  name: DESCRIBE_TOOL_NAME,
  description: "Return a one-sentence description of this content.",
  input_schema: {
    type: "object" as const,
    properties: {
      description: {
        type: "string",
        description:
          "A concise one-sentence summary of what this content is about.",
      },
    },
    required: ["description"],
  },
};

const TIMEOUT_MS = 10_000;
const MAX_CONTENT_CHARS = 8000;

/**
 * Generate a short description of a file using the LLM.
 * For textual files, summarises the content.
 * For binary/non-textual files, describes based on filename and mime type.
 */
export async function generateDescription(
  config: Required<BotholomewConfig>,
  opts: {
    filename: string;
    mimeType: string;
    content: string | null;
  },
): Promise<string> {
  if (!config.anthropic_api_key) {
    return "";
  }

  const client = new Anthropic({ apiKey: config.anthropic_api_key });

  let prompt: string;
  if (opts.content) {
    const truncated =
      opts.content.length > MAX_CONTENT_CHARS
        ? `${opts.content.slice(0, MAX_CONTENT_CHARS)}\n... (truncated)`
        : opts.content;
    prompt = `Describe this file in one sentence. Be specific about what it contains, not generic.

Filename: ${opts.filename}
MIME type: ${opts.mimeType}

Content:
${truncated}`;
  } else {
    prompt = `Describe this file in one sentence based on its name and type. Be specific.

Filename: ${opts.filename}
MIME type: ${opts.mimeType}`;
  }

  try {
    const response = await Promise.race([
      client.messages.create({
        model: config.chunker_model,
        max_tokens: 256,
        tools: [DESCRIBE_TOOL],
        tool_choice: { type: "tool", name: DESCRIBE_TOOL_NAME },
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Description generation timeout")),
          TIMEOUT_MS,
        ),
      ),
    ]);

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") return "";

    const input = toolBlock.input as { description: string };
    return input.description || "";
  } catch (err) {
    logger.debug(`Description generation failed: ${err}`);
    return "";
  }
}
