-- Pending actions: a write-tool call Quinn proposed but has not executed,
-- awaiting agent approval within a TTL. `pending_action_id` on
-- assistant_tool_calls (added in the next migration) links the eventual
-- execution audit row back to the proposal that authorized it.
CREATE TABLE "assistant_pending_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"involvement_id" uuid,
	"tool_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions"
	ADD CONSTRAINT "assistant_pending_actions_conversation_id_conversations_id_fk"
	FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Name truncated to Postgres's 63-byte identifier limit (matches the TS schema).
ALTER TABLE "assistant_pending_actions"
	ADD CONSTRAINT "assistant_pending_actions_involvement_id_assistant_involvements"
	FOREIGN KEY ("involvement_id") REFERENCES "public"."assistant_involvements"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions"
	ADD CONSTRAINT "assistant_pending_actions_decided_by_id_principal_id_fk"
	FOREIGN KEY ("decided_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions"
	ADD CONSTRAINT "assistant_pending_actions_status_check"
	CHECK ("status" IN ('proposed','approved','rejected','expired','executed','failed'));
--> statement-breakpoint
CREATE INDEX "assistant_pending_actions_conversation_proposed_idx"
	ON "assistant_pending_actions" USING btree ("conversation_id")
	WHERE "status" = 'proposed';
