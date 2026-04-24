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
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

async function buildMessageContent(
  opts: DescriberOpts,
): Promise<Anthropic.Messages.ContentBlockParam[]> {
  const textPrompt = `Describe this file in one sentence. Be specific about what it contains, not generic.\n\nFilename: ${opts.filename}\nMIME type: ${opts.mimeType}`;

  if (opts.content) {
    const truncated =
      opts.content.length > MAX_CONTENT_CHARS
        ? `${opts.content.slice(0, MAX_CONTENT_CHARS)}\n... (truncated)`
        : opts.content;
    return [{ type: "text", text: `${textPrompt}\n\nContent:\n${truncated}` }];
  }

  if (opts.filePath) {
    const file = Bun.file(opts.filePath);
    const size = file.size;

    if (size > 0 && size <= MAX_FILE_BYTES) {
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");

      if (IMAGE_TYPES.has(opts.mimeType)) {
        return [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: opts.mimeType as ImageMediaType,
              data,
            },
          },
          { type: "text", text: textPrompt },
        ];
      }

      if (opts.mimeType === "application/pdf") {
        return [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data },
          },
          { type: "text", text: textPrompt },
        ];
      }
    }
  }

  return [
    {
      type: "text",
      text: `${textPrompt}\n\n(Binary file — no content preview available)`,
    },
  ];
}

interface DescriberOpts {
  filename: string;
  mimeType: string;
  content: string | null;
  filePath?: string;
}

/**
 * Generate a short description of a file using the LLM.
 * For textual files, summarises the content.
 * For binary files, attaches images/PDFs directly or describes from metadata.
 */
export async function generateDescription(
  config: Required<BotholomewConfig>,
  opts: DescriberOpts,
): Promise<string> {
  if (!config.anthropic_api_key) {
    return "";
  }

  const client = new Anthropic({ apiKey: config.anthropic_api_key });

  try {
    const content = await buildMessageContent(opts);

    const response = await Promise.race([
      client.messages.create({
        model: config.chunker_model,
        max_tokens: 256,
        tools: [DESCRIBE_TOOL],
        tool_choice: { type: "tool", name: DESCRIBE_TOOL_NAME },
        messages: [{ role: "user", content }],
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
