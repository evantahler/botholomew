ALTER TABLE "workflow_steps" ADD COLUMN "step_type" varchar(50) DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "condition_type" varchar(50);--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "condition_value" varchar(1000);--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "condition_expression" varchar(2000);--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "branches" jsonb;