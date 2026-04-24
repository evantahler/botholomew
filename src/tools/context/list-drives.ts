import { z } from "zod";
import { listDriveSummaries } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({});

const outputSchema = z.object({
  drives: z.array(
    z.object({
      drive: z.string(),
      count: z.number(),
    }),
  ),
  is_error: z.boolean(),
  hint: z.string().optional(),
});

export const contextListDrivesTool = {
  name: "context_list_drives",
  description:
    "List every drive that currently has content, with its item count. Use this to discover which values to pass as `drive` on other context tools (disk / url / agent / google-docs / github / …).",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (_input, ctx) => {
    const drives = await listDriveSummaries(ctx.conn);
    if (drives.length === 0) {
      return {
        drives: [],
        is_error: false,
        hint: "No context has been ingested yet. The user can run `botholomew context add <path-or-url>` to add content.",
      };
    }
    return { drives, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
