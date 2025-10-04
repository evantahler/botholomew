DO $$ BEGIN
 CREATE TYPE "memory_type" AS ENUM('fact', 'conversation', 'result', 'context');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"agent_id" integer NOT NULL,
	"key" varchar(256) NOT NULL,
	"content" text NOT NULL,
	"memory_type" "memory_type" DEFAULT 'fact' NOT NULL,
	"workflow_run_id" integer,
	"metadata" json DEFAULT '{}'::json NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
