import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getPromptsDir } from "../../constants.ts";
import {
  PromptValidationError,
  parsePromptFile,
} from "../../utils/frontmatter.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z
    .string()
    .describe("Prompt name without extension. Resolves to prompts/<name>.md."),
});

const outputSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  deleted: z.boolean(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const promptDeleteTool = {
  name: "prompt_delete",
  description:
    "[[ bash equivalent command: rm ]] Delete a prompt file under prompts/. Files marked `agent-modification: false` are protected and will not be removed.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (input.name.includes("/") || input.name.includes("..")) {
      return {
        name: input.name,
        path: null,
        deleted: false,
        is_error: true,
        error_type: "invalid_name",
        message: `Invalid prompt name: ${input.name}`,
      };
    }

    const filePath = join(getPromptsDir(ctx.projectDir), `${input.name}.md`);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return {
        name: input.name,
        path: null,
        deleted: false,
        is_error: true,
        error_type: "not_found",
        message: `Prompt not found: prompts/${input.name}.md`,
        next_action_hint: "Use prompt_list to see available prompts.",
      };
    }

    const raw = await file.text();
    try {
      const { meta } = parsePromptFile(filePath, raw);
      if (!meta["agent-modification"]) {
        return {
          name: input.name,
          path: filePath,
          deleted: false,
          is_error: true,
          error_type: "agent_modification_disabled",
          message: `Agent deletion not allowed for prompts/${input.name}.md`,
          next_action_hint:
            "Edit the file manually with `botholomew prompts delete` or your editor.",
        };
      }
    } catch (err) {
      // A malformed prompt is still a valid target for deletion — the agent
      // shouldn't be locked out of cleaning up an unparseable file. Surface
      // the parse error in the message but allow the unlink.
      const reason =
        err instanceof PromptValidationError
          ? err.reason
          : err instanceof Error
            ? err.message
            : String(err);
      await unlink(filePath);
      return {
        name: input.name,
        path: filePath,
        deleted: true,
        is_error: false,
        message: `Deleted unparseable prompt (${reason})`,
      };
    }

    await unlink(filePath);
    return {
      name: input.name,
      path: filePath,
      deleted: true,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
