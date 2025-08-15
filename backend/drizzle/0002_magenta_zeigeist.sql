DO $$ BEGIN
 CREATE TYPE "workflow_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "step_type" AS ENUM('agent', 'condition', 'loop', 'webhook', 'delay', 'manual', 'timer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"workflow_id" integer NOT NULL,
	"workflow_run_status" "workflow_run_status" DEFAULT 'pending' NOT NULL,
	"input" json DEFAULT '{}'::json NOT NULL,
	"output" json,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"metadata" json DEFAULT '{}'::json NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"workflow_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"step_type" "step_type" NOT NULL,
	"order" integer NOT NULL,
	"next_step_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "workflow_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "schedule";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "schedule_next_run";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "schedule_last_run";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "schedule_last_run_result";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "schedule_last_run_error";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_next_step_id_workflow_steps_id_fk" FOREIGN KEY ("next_step_id") REFERENCES "workflow_steps"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
