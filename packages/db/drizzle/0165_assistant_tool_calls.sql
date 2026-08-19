-- Tool-call audit log: one row per assistant tool invocation. Claimed via
-- INSERT ... ON CONFLICT DO NOTHING on the partial-unique idempotency index so
-- a retried call never re-runs its side-effect.
CREATE TABLE "assistant_tool_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid,
	"involvement_id" uuid,
	"pending_action_id" uuid,
	"tool_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"result_summary" text,
	"error" text,
	"latency_ms" integer,
	"idempotency_key" text,
	"principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls"
	ADD CONSTRAINT "assistant_tool_calls_conversation_id_conversations_id_fk"
	FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Names truncated to Postgres's 63-byte identifier limit (match the TS schema).
ALTER TABLE "assistant_tool_calls"
	ADD CONSTRAINT "assistant_tool_calls_involvement_id_assistant_involvements_id_f"
	FOREIGN KEY ("involvement_id") REFERENCES "public"."assistant_involvements"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls"
	ADD CONSTRAINT "assistant_tool_calls_pending_action_id_assistant_pending_action"
	FOREIGN KEY ("pending_action_id") REFERENCES "public"."assistant_pending_actions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls"
	ADD CONSTRAINT "assistant_tool_calls_principal_id_principal_id_fk"
	FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls"
	ADD CONSTRAINT "assistant_tool_calls_status_check"
	CHECK ("status" IN ('started','succeeded','failed','denied','skipped_duplicate'));
--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_conversation_id_created_at_idx"
	ON "assistant_tool_calls" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_tool_calls_idempotency_key_idx"
	ON "assistant_tool_calls" USING btree ("idempotency_key")
	WHERE "idempotency_key" IS NOT NULL;
