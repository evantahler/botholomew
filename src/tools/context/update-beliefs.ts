import { join } from "node:path";
import { z } from "zod";
import { getBotholomewDir } from "../../constants.ts";
import {
  type ContextFileMeta,
  parseContextFile,
  serializeContextFile,
} from "../../utils/frontmatter.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  content: z
    .string()
    .describe(
      "The new beliefs content (replaces existing body, frontmatter is preserved)",
    ),
});

const outputSchema = z.object({
  message: z.string(),
  path: z.string(),
  is_error: z.boolean(),
});

export const updateBeliefsTool = {
  name: "update_beliefs",
  description:
    "Update the agent's beliefs file (.botholomew/beliefs.md). Preserves frontmatter, replaces content body.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const filePath = join(getBotholomewDir(ctx.projectDir), "beliefs.md");
    const file = Bun.file(filePath);

    let meta: ContextFileMeta = {
      loading: "always",
      "agent-modification": true,
    };

    if (await file.exists()) {
      const raw = await file.text();
      const parsed = parseContextFile(raw);
      meta = parsed.meta;

      if (!meta["agent-modification"]) {
        return {
          message: "Agent modification not allowed for this file",
          path: filePath,
          is_error: true,
        };
      }
    }

    const serialized = serializeContextFile(meta, input.content);
    await Bun.write(filePath, serialized);

    return {
      message: "Updated beliefs.md",
      path: filePath,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
