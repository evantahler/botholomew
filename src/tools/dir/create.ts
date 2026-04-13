import { z } from "zod";
import { contextPathExists, createContextItem } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Directory path to create"),
  parents: z
    .boolean()
    .optional()
    .describe("Create parent directories as needed"),
});

const outputSchema = z.object({
  created: z.boolean(),
  path: z.string(),
});

export const dirCreateTool = {
  name: "dir_create",
  description: "Create a directory in the virtual filesystem.",
  group: "dir",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const exists = await contextPathExists(ctx.conn, input.path);
    if (exists) {
      return { created: false, path: input.path };
    }

    await createContextItem(ctx.conn, {
      title: input.path.split("/").filter(Boolean).pop() ?? input.path,
      contextPath: input.path,
      mimeType: "inode/directory",
      isTextual: false,
    });

    return { created: true, path: input.path };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
