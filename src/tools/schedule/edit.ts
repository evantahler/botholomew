import { z } from "zod";
import {
  atomicWriteIfUnchanged,
  MtimeConflictError,
  readWithMtime,
} from "../../fs/atomic.ts";
import { applyLinePatches, LinePatchSchema } from "../../fs/patches.ts";
import type { ScheduleFrontmatter } from "../../schedules/schema.ts";
import {
  parseScheduleFile,
  scheduleFilePath,
  serializeSchedule,
} from "../../schedules/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("Schedule id"),
  patches: z.array(LinePatchSchema).describe("Patches to apply"),
});

const outputSchema = z.object({
  id: z.string(),
  path: z.string().nullable(),
  applied: z.number(),
  content: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const scheduleEditTool = {
  name: "schedule_edit",
  description:
    "[[ bash equivalent command: patch ]] Apply git-style line-range patches to a schedule file. Operates on the whole file (frontmatter + body). Patches whose result fails frontmatter validation are rejected without writing. Re-serializes to canonicalize YAML and bump updated_at. Use schedule_list to find ids.",
  group: "schedule",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const filePath = scheduleFilePath(ctx.projectDir, input.id);
    const file = await readWithMtime(filePath);
    if (!file) {
      return {
        id: input.id,
        path: null,
        applied: 0,
        content: "",
        is_error: true,
        error_type: "not_found",
        message: `Schedule not found: ${input.id}`,
        next_action_hint:
          "Use schedule_list to see available schedules, or create_schedule to make one.",
      };
    }

    const original = file.content;
    const updated = applyLinePatches(original, input.patches);

    const parsed = parseScheduleFile(updated, file.mtimeMs);
    if (!parsed.ok) {
      return {
        id: input.id,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "invalid_schedule",
        message: `Patched content failed validation: ${parsed.reason}`,
        next_action_hint:
          "Check that frontmatter YAML stays valid and required fields (id, name, frequency, enabled, created_at, updated_at) are preserved.",
      };
    }
    if (parsed.schedule.id !== input.id) {
      return {
        id: input.id,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "id_mismatch",
        message: `frontmatter id '${parsed.schedule.id}' does not match the schedule id '${input.id}'`,
        next_action_hint:
          "Don't change the id frontmatter field; create a new schedule with create_schedule if you need a different id.",
      };
    }

    const fm: ScheduleFrontmatter = {
      id: parsed.schedule.id,
      name: parsed.schedule.name,
      description: parsed.schedule.description,
      frequency: parsed.schedule.frequency,
      enabled: parsed.schedule.enabled,
      last_run_at: parsed.schedule.last_run_at,
      created_at: parsed.schedule.created_at,
      updated_at: new Date().toISOString(),
    };
    const serialized = serializeSchedule(fm, parsed.schedule.body);

    try {
      await atomicWriteIfUnchanged(filePath, serialized, file.mtimeMs);
    } catch (err) {
      if (err instanceof MtimeConflictError) {
        return {
          id: input.id,
          path: filePath,
          applied: 0,
          content: original,
          is_error: true,
          error_type: "mtime_conflict",
          message: `Schedule was modified concurrently: ${err.message}`,
          next_action_hint:
            "Re-read the schedule with schedule_list and recompute your patch line numbers before retrying.",
        };
      }
      throw err;
    }

    return {
      id: input.id,
      path: filePath,
      applied: input.patches.length,
      content: serialized,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
