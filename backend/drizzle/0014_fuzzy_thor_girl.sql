ALTER TABLE "workflows" ADD COLUMN "schedule" varchar(256);--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "last_scheduled_at" timestamp;