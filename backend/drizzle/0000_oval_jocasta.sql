DO $$ BEGIN
 CREATE TYPE "run_status" AS ENUM('pending', 'running', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "response_type" AS ENUM('text', 'json', 'markdown');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"agent_id" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"user_message" text NOT NULL,
	"response" text,
	"type" "response_type" NOT NULL,
	"run_status" "run_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text,
	"model" varchar(256) NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt" text NOT NULL,
	"response_type" "response_type" DEFAULT 'text' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"schedule" text,
	"schedule_next_run" timestamp,
	"schedule_last_run" timestamp,
	"schedule_last_run_result" text,
	"schedule_last_run_error" text,
	"toolkits" json DEFAULT '[]'::json NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "toolkit_authorizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" integer NOT NULL,
	"toolkit_name" varchar(256) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" varchar(256) NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_id_toolkit_name_idx" ON "toolkit_authorizations" ("user_id","toolkit_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "name_idx" ON "users" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_idx" ON "users" ("email");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "toolkit_authorizations" ADD CONSTRAINT "toolkit_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
