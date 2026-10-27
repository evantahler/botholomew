import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getPromptsDir } from "../../constants.ts";
import { atomicWrite } from "../../fs/atomic.ts";
import {
  PromptValidationError,
  parsePromptFile,
  serializePromptFile,
} from "../../utils/frontmatter.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Prompt name without extension (e.g. 'style-notes'). Resolves to prompts/<name>.md.",
    ),
  title: z
    .string()
    .min(1)
    .describe("Human-readable title shown in prompt_list output."),
  loading: z
    .enum(["always", "contextual"])
    .describe(
      "'always' includes the prompt in every system prompt. 'contextual' includes it only when the latest user/task text shares keywords with the body.",
    ),
  agent_modification: z
    .boolean()
    .describe(
      "If true, prompt_edit and prompt_delete may modify or remove this file. If false, the file is read-only to the agent.",
    ),
  body: z
    .string()
    .describe("Markdown body (everything after the frontmatter)."),
  on_conflict: z
    .enum(["error", "overwrite"])
    .optional()
    .default("error")
    .describe(
      "What to do if a prompt with this name already exists. Defaults to 'error'.",
    ),
});

const outputSchema = z.object({
  name: z.string().nullable(),
  path: z.string().nullable(),
  created: z.boolean(),
  content: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

const VALID_NAME = /^[a-zA-Z0-9._-]+$/;

export const promptCreateTool = {
  name: "prompt_create",
  description:
    "[[ bash equivalent command: touch ]] Create a new prompt file under prompts/. Frontmatter (title, loading, agent-modification) is set from the arguments and re-validated before the file is committed. Fails with path_conflict if a prompt with this name exists unless on_conflict='overwrite'.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!VALID_NAME.test(input.name) || input.name.includes("..")) {
      return {
        name: null,
        path: null,
        created: false,
        content: "",
        is_error: true,
        error_type: "invalid_name",
        message: `Invalid prompt name: ${input.name}`,
        next_action_hint:
          "Use [a-zA-Z0-9._-] only — no slashes, no '..', no extension.",
      };
    }

    const dir = getPromptsDir(ctx.projectDir);
    const filePath = join(dir, `${input.name}.md`);
    const exists = await Bun.file(filePath).exists();
    if (exists && input.on_conflict !== "overwrite") {
      return {
        name: input.name,
        path: filePath,
        created: false,
        content: "",
        is_error: true,
        error_type: "path_conflict",
        message: `Prompt already exists: prompts/${input.name}.md`,
        next_action_hint:
          "Pass on_conflict='overwrite' to replace, or use prompt_edit for a partial change.",
      };
    }

    const meta = {
      title: input.title,
      loading: input.loading,
      "agent-modification": input.agent_modification,
    };
    const serialized = serializePromptFile(meta, input.body);

    // Round-trip validation: refuse to write content that wouldn't load back.
    try {
      parsePromptFile(filePath, serialized);
    } catch (err) {
      return {
        name: input.name,
        path: filePath,
        created: false,
        content: serialized,
        is_error: true,
        error_type: "invalid_frontmatter",
        message:
          err instanceof PromptValidationError
            ? err.message
            : `Generated content failed validation: ${err instanceof Error ? err.message : String(err)}`,
        next_action_hint:
          "Pick a title without unusual characters that break YAML.",
      };
    }

    await mkdir(dir, { recursive: true });
    await atomicWrite(filePath, serialized);

    return {
      name: input.name,
      path: filePath,
      created: !exists,
      content: serialized,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
