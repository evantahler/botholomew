import { z } from "zod";

export const ScheduleFrontmatterSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().default(""),
  frequency: z.string(),
  enabled: z.boolean().default(true),
  last_run_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ScheduleFrontmatter = z.infer<typeof ScheduleFrontmatterSchema>;

export interface Schedule extends ScheduleFrontmatter {
  mtimeMs: number;
  body: string;
}
