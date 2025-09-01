ALTER TABLE "workflow_runs" ALTER COLUMN "input" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "input" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "input" DROP NOT NULL;