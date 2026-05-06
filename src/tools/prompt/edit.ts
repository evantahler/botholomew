import { join } from "node:path";
import { z } from "zod";
import { getPromptsDir } from "../../constants.ts";
import {
  atomicWriteIfUnchanged,
  MtimeConflictError,
  readWithMtime,
} from "../../fs/atomic.ts";
import { applyLinePatches, LinePatchSchema } from "../../fs/patches.ts";
import {
  parseContextFile,
  serializeContextFile,
} from "../../utils/frontmatter.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z
    .string()
    .describe(
      "Prompt name without extension (e.g. 'beliefs', 'goals', 'capabilities'). Resolves to prompts/<name>.md.",
    ),
  patches: z.array(LinePatchSchema).describe("Patches to apply"),
});

const outputSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  applied: z.number(),
  content: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const promptEditTool = {
  name: "prompt_edit",
  description:
    "[[ bash equivalent command: patch ]] Apply git-style line-range patches to a prompt file under prompts/. Operates on the whole file (frontmatter + body). Files marked `agent-modification: false` (e.g. soul.md) are protected. Use prompt_read first to inspect current line numbers.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (input.name.includes("/") || input.name.includes("..")) {
      return {
        name: input.name,
        path: null,
        applied: 0,
        content: "",
        is_error: true,
        error_type: "invalid_name",
        message: `Invalid prompt name: ${input.name}`,
        next_action_hint:
          "Use a basename without slashes or dots (e.g. 'beliefs').",
      };
    }
    const filePath = join(getPromptsDir(ctx.projectDir), `${input.name}.md`);
    const file = await readWithMtime(filePath);
    if (!file) {
      return {
        name: input.name,
        path: null,
        applied: 0,
        content: "",
        is_error: true,
        error_type: "not_found",
        message: `Prompt not found: prompts/${input.name}.md`,
      };
    }

    const original = file.content;
    const preParsed = parseContextFile(original);
    if (!preParsed.meta["agent-modification"]) {
      return {
        name: input.name,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "agent_modification_disabled",
        message: `Agent modification not allowed for prompts/${input.name}.md`,
      };
    }

    const updated = applyLinePatches(original, input.patches);
    let postParsed: { meta: Record<string, unknown>; content: string };
    try {
      postParsed = parseContextFile(updated);
    } catch (err) {
      return {
        name: input.name,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "invalid_frontmatter",
        message: `Patched content failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        next_action_hint:
          "Check that the frontmatter delimiters and YAML stay valid.",
      };
    }
    if (!postParsed.meta["agent-modification"]) {
      return {
        name: input.name,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "agent_modification_disabled",
        message: `Patch would clear agent-modification on prompts/${input.name}.md`,
        next_action_hint:
          "Don't change the agent-modification frontmatter flag.",
      };
    }

    const serialized = serializeContextFile(
      postParsed.meta,
      postParsed.content,
    );

    try {
      await atomicWriteIfUnchanged(filePath, serialized, file.mtimeMs);
    } catch (err) {
      if (err instanceof MtimeConflictError) {
        return {
          name: input.name,
          path: filePath,
          applied: 0,
          content: original,
          is_error: true,
          error_type: "mtime_conflict",
          message: `Prompt was modified concurrently: ${err.message}`,
          next_action_hint:
            "Re-read with prompt_read and recompute your patch line numbers before retrying.",
        };
      }
      throw err;
    }

    return {
      name: input.name,
      path: filePath,
      applied: input.patches.length,
      content: serialized,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
