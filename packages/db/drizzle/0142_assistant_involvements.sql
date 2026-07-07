-- Assistant involvement record: one row per conversation the in-product AI
-- agent (Quinn) engages. The audit/KPI reporting spine — trigger, terminal
-- status, structured hand-off reason, cited sources, and CSAT rating. Cascades
-- with its conversation.
CREATE TABLE "assistant_involvements" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL,
  "triggered_by" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "handoff_reason" text,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rating" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assistant_involvements"
  ADD CONSTRAINT "assistant_involvements_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "assistant_involvements_conversation_id_idx"
  ON "assistant_involvements" USING btree ("conversation_id");
--> statement-breakpoint
-- Two timestamps on the assistant involvement record (Quinn messenger wiring,
-- SUPPORT-PLATFORM-SPEC §4.7):
--   escalation_offered_at    : stamped when Quinn makes its single escalation
--                              OFFER. Its presence is the "already offered" flag
--                              the engine reads, so a repeat escalation goes
--                              straight to hand-off (never offered twice).
--   last_assistant_answer_at : the time of Quinn's last substantive answer. The
--                              inactivity clock the stale-involvement sweep reads
--                              to assume a resolution once the customer goes quiet.
ALTER TABLE "assistant_involvements" ADD COLUMN "escalation_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_involvements" ADD COLUMN "last_assistant_answer_at" timestamp with time zone;--> statement-breakpoint
-- Partial index for the stale-involvement sweep: it scans active involvements by
-- last-answer time, so only active rows need to be indexed.
CREATE INDEX IF NOT EXISTS assistant_involvements_active_answer_idx ON assistant_involvements (last_assistant_answer_at) WHERE status = 'active';
