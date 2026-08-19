-- Workflows engine (support platform §4.6). ONE engine is routing + SLA-apply +
-- CSAT + auto-close + reply-expectations + AI-deploy + lead-capture; there is no
-- separate routing engine. A workflow = one trigger + a JSONB graph of
-- condition/branch/action/wait nodes. Two classes drive execution: customer_facing
-- runs are EXCLUSIVE per conversation (first match by sort_order wins, locked
-- while running); background runs go in parallel. The graph is stored whole
-- (JSONB) because the canvas reads/writes it as a unit and no query needs a single
-- node cross-workflow. `order` is reserved, so the drag column is `sort_order`.
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"class" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"graph" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
-- set null: a removed author leaves the workflow, not an orphan.
ALTER TABLE "workflows"
	ADD CONSTRAINT "workflows_created_by_fkey"
	FOREIGN KEY ("created_by") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- The dispatcher's hot query: live workflows for a trigger, in drag order.
CREATE INDEX "workflows_trigger_status_order_idx"
	ON "workflows" ("trigger_type", "status", "sort_order");
--> statement-breakpoint

CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	-- The locked conversation for a customer_facing run (null for a person-scoped
	-- background run).
	"conversation_id" uuid,
	-- The person a run acts on, for per-person frequency caps.
	"subject_principal_id" uuid,
	"state" text DEFAULT 'running' NOT NULL,
	-- Current node + wait-until, so a durable wait resumes exactly where it paused.
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
-- cascade: runs are operational state, they die with their workflow / conversation.
ALTER TABLE "workflow_runs"
	ADD CONSTRAINT "workflow_runs_workflow_id_fkey"
	FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "workflow_runs"
	ADD CONSTRAINT "workflow_runs_conversation_id_fkey"
	FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "workflow_runs"
	ADD CONSTRAINT "workflow_runs_subject_principal_id_fkey"
	FOREIGN KEY ("subject_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- The exclusive-lock probe: is a customer_facing run already live on this
-- conversation? Partial on the active states so it stays small.
CREATE INDEX "workflow_runs_conversation_state_idx"
	ON "workflow_runs" ("conversation_id", "state")
	WHERE "conversation_id" IS NOT NULL;
--> statement-breakpoint
-- The durable-wait sweeper scans waiting runs.
CREATE INDEX "workflow_runs_state_idx" ON "workflow_runs" ("state");
--> statement-breakpoint

CREATE TABLE "workflow_run_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"subject_principal_id" uuid,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run_events"
	ADD CONSTRAINT "workflow_run_events_run_id_fkey"
	FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "workflow_run_events"
	ADD CONSTRAINT "workflow_run_events_workflow_id_fkey"
	FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "workflow_run_events"
	ADD CONSTRAINT "workflow_run_events_subject_principal_id_fkey"
	FOREIGN KEY ("subject_principal_id") REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- The frequency-cap accounting query: N events per person per period per workflow.
CREATE INDEX "workflow_run_events_cap_idx"
	ON "workflow_run_events" ("workflow_id", "subject_principal_id", "at");
--> statement-breakpoint
-- Exclusive-lock race fix (support platform §4.6): hasActiveCustomerFacingRun is
-- a read-only pre-check, so two triggers dispatched close together (e.g.
-- conversation.created and the first message.created) can both pass it and start
-- two customer_facing runs on the same conversation. `customer_facing` is
-- denormalized from workflows.class onto workflow_runs so the lock is enforced
-- by a partial unique index at insert time rather than read-then-write logic;
-- the engine treats a unique violation on it as "another run already claimed
-- this conversation" and skips instead of throwing.
ALTER TABLE "workflow_runs" ADD COLUMN "customer_facing" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "workflow_runs"
	SET "customer_facing" = true
	FROM "workflows"
	WHERE "workflow_runs"."workflow_id" = "workflows"."id"
	AND "workflows"."class" = 'customer_facing';
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_exclusive_customer_facing_idx"
	ON "workflow_runs" ("conversation_id")
	WHERE "state" IN ('running', 'waiting') AND "customer_facing";
