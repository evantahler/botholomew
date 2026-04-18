import Anthropic from "@anthropic-ai/sdk";
import type { BotholomewConfig } from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";

const DESCRIBE_TOOL_NAME = "return_description";
const DESCRIBE_AND_PLACE_TOOL_NAME = "return_description_and_path";

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

const DESCRIBE_AND_PLACE_TOOL = {
  name: DESCRIBE_AND_PLACE_TOOL_NAME,
  description:
    "Return a one-sentence description AND a suggested absolute folder path for this file.",
  input_schema: {
    type: "object" as const,
    properties: {
      description: {
        type: "string",
        description:
          "A concise one-sentence summary of what this content is about.",
      },
      suggested_path: {
        type: "string",
        description:
          "Absolute virtual-filesystem path (starts with /) where this file should live, including the filename. Prefer existing folders. Include a project/source disambiguator (e.g. /projects/<source-dir>/README.md) when the basename is likely to collide.",
      },
    },
    required: ["description", "suggested_path"],
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

/**
 * Build the message content array for the LLM description request.
 * Attaches the file as an image or document block when possible.
 */
async function buildMessageContent(
  opts: DescriberOpts,
  includePlacement: boolean,
): Promise<Anthropic.Messages.ContentBlockParam[]> {
  const placementBlock = includePlacement
    ? [
        "",
        "Also suggest an absolute folder path where this file should live in the virtual filesystem. Rules:",
        "- Start with /",
        "- Keep the basename close to the source filename",
        "- STRONGLY prefer folders that already exist below — reuse them unless the new file is clearly unrelated to everything there. Do NOT invent a new folder that is a near-synonym of an existing one.",
        "- Use at most 3 nested folders unless an existing folder already goes deeper",
        "- If the basename is common (README.md, index.md, notes.md), include a project/source disambiguator from the source path",
        opts.existingTree
          ? `\nExisting filesystem (folders end with /, files are listed under the folders they live in so you can see what kinds of documents are already there):\n${opts.existingTree}`
          : "\nExisting filesystem: (empty — you are placing the first file)",
        opts.sourcePath ? `\nSource filesystem path: ${opts.sourcePath}` : "",
      ]
        .filter((s) => s.length > 0)
        .join("\n")
    : "";

  const textPrompt = `Describe this file in one sentence. Be specific about what it contains, not generic.\n\nFilename: ${opts.filename}\nMIME type: ${opts.mimeType}${placementBlock ? `\n${placementBlock}` : ""}`;

  // Text file — include content inline
  if (opts.content) {
    const truncated =
      opts.content.length > MAX_CONTENT_CHARS
        ? `${opts.content.slice(0, MAX_CONTENT_CHARS)}\n... (truncated)`
        : opts.content;
    return [{ type: "text", text: `${textPrompt}\n\nContent:\n${truncated}` }];
  }

  // Binary file — try to attach if we have a file path
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

  // Fallback — describe from filename and MIME type only
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
  sourcePath?: string;
  existingTree?: string;
}

/** Normalize and validate an LLM-suggested path. Returns null if invalid. */
export function sanitizeSuggestedPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("..")) return null;
  // Collapse repeated slashes, strip trailing slash (unless root).
  const collapsed = trimmed.replace(/\/+/g, "/");
  if (collapsed === "/") return null; // needs a filename
  return collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
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
    const content = await buildMessageContent(opts, false);

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

/**
 * Generate description + suggested_path in a single LLM call.
 * Returns { description, suggested_path } on success, or null on failure.
 */
export async function generateDescriptionAndPath(
  config: Required<BotholomewConfig>,
  opts: DescriberOpts,
): Promise<{ description: string; suggested_path: string } | null> {
  if (!config.anthropic_api_key) return null;

  const client = new Anthropic({ apiKey: config.anthropic_api_key });

  try {
    const content = await buildMessageContent(opts, true);

    const response = await Promise.race([
      client.messages.create({
        model: config.chunker_model,
        max_tokens: 512,
        tools: [DESCRIBE_AND_PLACE_TOOL],
        tool_choice: { type: "tool", name: DESCRIBE_AND_PLACE_TOOL_NAME },
        messages: [{ role: "user", content }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Description+path generation timeout")),
          TIMEOUT_MS,
        ),
      ),
    ]);

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") return null;

    const input = toolBlock.input as {
      description?: string;
      suggested_path?: string;
    };
    const suggested = input.suggested_path
      ? sanitizeSuggestedPath(input.suggested_path)
      : null;
    if (!suggested) return null;
    return {
      description: input.description || "",
      suggested_path: suggested,
    };
  } catch (err) {
    logger.debug(`Description+path generation failed: ${err}`);
    return null;
  }
}
