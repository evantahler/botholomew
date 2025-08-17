ALTER TABLE "workflow_steps" ADD COLUMN "position" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_steps" DROP COLUMN IF EXISTS "next_step_id";