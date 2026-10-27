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
    .describe(
      "Prompt name without extension (e.g. 'beliefs', 'goals'). Resolves to prompts/<name>.md.",
    ),
});

const outputSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  content: z.string(),
  title: z.string().nullable(),
  loading: z.string().nullable(),
  agent_modification: z.boolean(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const promptReadTool = {
  name: "prompt_read",
  description:
    "[[ bash equivalent command: cat ]] Read a prompt file under prompts/. Returns the whole file (frontmatter + body) plus the parsed title / loading / agent_modification flags so you can decide whether prompt_edit will be accepted.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (input.name.includes("/") || input.name.includes("..")) {
      return {
        name: input.name,
        path: null,
        content: "",
        title: null,
        loading: null,
        agent_modification: false,
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
        content: "",
        title: null,
        loading: null,
        agent_modification: false,
        is_error: true,
        error_type: "not_found",
        message: `Prompt not found: prompts/${input.name}.md`,
        next_action_hint: "Use prompt_list to see available prompts.",
      };
    }
    const content = await file.text();
    try {
      const { meta } = parsePromptFile(filePath, content);
      return {
        name: input.name,
        path: filePath,
        content,
        title: meta.title,
        loading: meta.loading,
        agent_modification: meta["agent-modification"],
        is_error: false,
      };
    } catch (err) {
      const message =
        err instanceof PromptValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        name: input.name,
        path: filePath,
        content,
        title: null,
        loading: null,
        agent_modification: false,
        is_error: true,
        error_type: "invalid_frontmatter",
        message,
        next_action_hint:
          "Fix the file's frontmatter (required: title, loading, agent-modification). The raw content is returned for inspection.",
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
