-- @contract: additive
-- Durable Quinn execution (QUINN-PRODUCT P1). Expand-only: every column is
-- nullable or defaulted, and no existing reader changes meaning. Apply before
-- deploying the durable execution selector; legacy execution ignores all of it.
-- Foreign keys are declared inline so every statement replays as a no-op
-- (a bare ADD CONSTRAINT errors on a second run and breaks the ledger heal).
CREATE TABLE IF NOT EXISTS "assistant_effective_snapshots" (
  "id" uuid PRIMARY KEY NOT NULL,
  "content_hash" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_effective_snapshots_hash_idx" ON "assistant_effective_snapshots" ("content_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid,
  "ticket_id" uuid,
  "workspace_thread_key" text,
  "role" text DEFAULT 'customer_support' NOT NULL,
  "surface" text NOT NULL,
  "trigger_kind" text NOT NULL,
  "trigger_key" text NOT NULL,
  "trigger_message_id" uuid,
  "delegation" jsonb,
  "requested_by_principal_id" uuid,
  "involvement_id" uuid,
  "snapshot_id" uuid,
  "status" text DEFAULT 'queued' NOT NULL,
  "phase" text DEFAULT 'context' NOT NULL,
  "outcome" text,
  "input_revision" bigint DEFAULT 0 NOT NULL,
  "state_version" integer DEFAULT 0 NOT NULL,
  "job_id" text,
  "job_lease_token" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "result_message_id" uuid,
  "error_reason" text,
  "disposition" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_runs_parent_check" CHECK (num_nonnulls("conversation_id", "ticket_id", "workspace_thread_key") = 1),
  CONSTRAINT "assistant_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "assistant_runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "assistant_runs_trigger_message_id_conversation_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "conversation_messages"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "assistant_runs_requested_by_principal_id_principal_id_fk" FOREIGN KEY ("requested_by_principal_id") REFERENCES "principal"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "assistant_runs_involvement_id_assistant_involvements_id_fk" FOREIGN KEY ("involvement_id") REFERENCES "assistant_involvements"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "assistant_runs_snapshot_id_assistant_effective_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "assistant_effective_snapshots"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "assistant_runs_result_message_id_conversation_messages_id_fk" FOREIGN KEY ("result_message_id") REFERENCES "conversation_messages"("id") ON DELETE set null ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_runs_trigger_key_idx" ON "assistant_runs" ("trigger_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_runs_one_executing_idx" ON "assistant_runs" ("conversation_id")
  WHERE "status" IN ('running', 'waiting_action') AND "conversation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_runs_conversation_created_idx" ON "assistant_runs" ("conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_runs_open_idx" ON "assistant_runs" ("updated_at")
  WHERE "status" IN ('queued', 'running', 'waiting_action');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_run_steps" (
  "id" uuid PRIMARY KEY NOT NULL,
  "run_id" uuid NOT NULL,
  "step_key" text NOT NULL,
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "step_kind" text NOT NULL,
  "input_digest" text,
  "status" text DEFAULT 'started' NOT NULL,
  "output" jsonb,
  "model_id" text,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "tool_call_id" text,
  "validator" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "assistant_run_steps_run_id_assistant_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_run_steps_identity_idx" ON "assistant_run_steps" ("run_id", "step_key", "attempt_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_run_steps_run_idx" ON "assistant_run_steps" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_run_evidence" (
  "id" uuid PRIMARY KEY NOT NULL,
  "run_id" uuid NOT NULL,
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "source_version" text,
  "chunk_id" text,
  "passage" text,
  "audience" text,
  "provenance" text,
  "retrieval_rank" integer,
  "rerank_rank" integer,
  "citation_index" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_run_evidence_run_id_assistant_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE cascade ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "assistant_run_evidence_run_idx" ON "assistant_run_evidence" ("run_id", "attempt_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_run_evidence_source_idx" ON "assistant_run_evidence" ("source_type", "source_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_request_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "principal_id" uuid NOT NULL,
  "client_mutation_id" text NOT NULL,
  "request_digest" text NOT NULL,
  "conversation_id" uuid,
  "message_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_request_receipts_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principal"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "assistant_request_receipts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "assistant_request_receipts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_request_receipts_key_idx" ON "assistant_request_receipts" ("principal_id", "client_mutation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_request_receipts_created_idx" ON "assistant_request_receipts" ("created_at");
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "assistant_revision" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "assistant_run_id" uuid;
--> statement-breakpoint
-- No foreign key back to assistant_runs on purpose: assistant_runs already
-- references this table in both directions it needs, and a second edge would
-- make the two Drizzle table types mutually recursive. Runs and messages share
-- one parent conversation and are cascade-deleted together.
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_assistant_run_terminal_idx" ON "conversation_messages" ("assistant_run_id")
  WHERE "assistant_run_id" IS NOT NULL AND "is_internal" = false;
