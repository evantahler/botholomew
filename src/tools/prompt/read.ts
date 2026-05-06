import { join } from "node:path";
import { z } from "zod";
import { getPromptsDir } from "../../constants.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z
    .string()
    .describe(
      "Prompt name without extension (e.g. 'beliefs', 'goals', 'capabilities'). Resolves to prompts/<name>.md.",
    ),
});

const outputSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  content: z.string(),
  agent_modification: z.boolean(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const promptReadTool = {
  name: "prompt_read",
  description:
    "[[ bash equivalent command: cat ]] Read a prompt file under prompts/ (e.g. beliefs, goals, capabilities, soul). Returns the whole file (frontmatter + body) for use with prompt_edit.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (input.name.includes("/") || input.name.includes("..")) {
      return {
        name: input.name,
        path: null,
        content: "",
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
        agent_modification: false,
        is_error: true,
        error_type: "not_found",
        message: `Prompt not found: prompts/${input.name}.md`,
      };
    }
    const content = await file.text();
    // Cheap header sniff so the agent knows whether prompt_edit will be
    // accepted before it constructs patches.
    const agent_modification = /agent-modification:\s*true/.test(
      content.split("---", 3).slice(0, 3).join("---"),
    );
    return {
      name: input.name,
      path: filePath,
      content,
      agent_modification,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
