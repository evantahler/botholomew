import { z } from "zod";

export const ScheduleFrontmatterSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().default(""),
  frequency: z.string(),
  enabled: z.boolean().default(true),
  /** Named entry in `config.models` that tasks spawned by this schedule inherit. The schedule's own due/not-due evaluation always uses `fast_model`. */
  model: z.string().nullable().default(null),
  last_run_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ScheduleFrontmatter = z.infer<typeof ScheduleFrontmatterSchema>;

export interface Schedule extends ScheduleFrontmatter {
  mtimeMs: number;
  body: string;
}
