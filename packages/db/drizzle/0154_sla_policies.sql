-- SLA policies + events (support platform §4.6). Named reusable policies CRUDed
-- under Settings -> Support, applied ONLY via the Apply-SLA workflow action
-- (never matched ambiently). Clocks are office-hours-aware via
-- office_hours_schedule_id. The sla_events log is reserved here; the Apply-SLA
-- action + lazy breach evaluation write it in a later slice.
CREATE TABLE "sla_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"first_response_target_secs" integer,
	"next_response_target_secs" integer,
	"time_to_close_target_secs" integer,
	"pause_on_snooze" boolean DEFAULT true NOT NULL,
	"office_hours_schedule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
-- set null: a deleted schedule leaves the policy on 24/7 clocks, not orphaned.
ALTER TABLE "sla_policies"
	ADD CONSTRAINT "sla_policies_office_hours_schedule_id_fkey"
	FOREIGN KEY ("office_hours_schedule_id") REFERENCES "office_hours_schedules"("id") ON DELETE set null;
--> statement-breakpoint
CREATE TABLE "sla_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- cascade: the SLA history dies with its conversation.
ALTER TABLE "sla_events"
	ADD CONSTRAINT "sla_events_conversation_id_fkey"
	FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade;
--> statement-breakpoint
-- restrict: a policy with recorded history is soft-deleted, never hard-deleted.
ALTER TABLE "sla_events"
	ADD CONSTRAINT "sla_events_policy_id_fkey"
	FOREIGN KEY ("policy_id") REFERENCES "sla_policies"("id") ON DELETE restrict;
--> statement-breakpoint
-- The SLA timeline for a conversation (breach eval reads it newest-first).
CREATE INDEX "sla_events_conversation_at_idx" ON "sla_events" ("conversation_id", "at");
