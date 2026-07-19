-- Ticket-anchored SLAs + holiday calendars (support platform §4.6). TTR lives
-- on tickets only (FRT/NRT/TTC stay conversation-side): policies gain the
-- resolve target + the pending-pause flag, tickets gain their own sla_applied
-- stamp (mirroring conversations.sla_applied), and sla_events becomes
-- polymorphic so ticket clocks log against ticket_id. office_hours_schedules
-- gains the holiday calendar the clock engine skips over.

ALTER TABLE "sla_policies" ADD COLUMN "time_to_resolve_target_secs" integer;
--> statement-breakpoint
-- pause_on_pending: the ticket-clock twin of pause_on_snooze — pause TTR while
-- the ticket sits in a 'pending'-category status (waiting on customer / third
-- party).
ALTER TABLE "sla_policies" ADD COLUMN "pause_on_pending" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "office_hours_schedules" ADD COLUMN "holidays" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
-- The one active SLA on a ticket (mirrors conversations.sla_applied). NULL = none.
ALTER TABLE "tickets" ADD COLUMN "sla_applied" jsonb;
--> statement-breakpoint
-- Polymorphic subject: conversation clocks keep logging with conversation_id;
-- the ticket TTR clock logs with ticket_id and a NULL conversation_id
-- (back-office tickets have no conversation). Exactly one must be set.
ALTER TABLE "sla_events" ALTER COLUMN "conversation_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "sla_events" ADD COLUMN "ticket_id" uuid;
--> statement-breakpoint
-- cascade: the SLA timeline dies with its ticket, same as with a conversation.
ALTER TABLE "sla_events"
	ADD CONSTRAINT "sla_events_ticket_id_fkey"
	FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sla_events"
	ADD CONSTRAINT "sla_events_subject_check"
	CHECK ("conversation_id" IS NOT NULL OR "ticket_id" IS NOT NULL);
--> statement-breakpoint
-- The SLA timeline for a ticket (mirrors sla_events_conversation_at_idx).
CREATE INDEX "sla_events_ticket_at_idx" ON "sla_events" ("ticket_id", "at");
--> statement-breakpoint
-- Reporting group-by (attainment per policy over a range).
CREATE INDEX "sla_events_policy_at_idx" ON "sla_events" ("policy_id", "at");
--> statement-breakpoint
-- Ticket sweep candidate set — mirrors conversations_sla_unsettled_idx (0187):
-- the predicate selects stamps with an UNSETTLED clock, not just any stamp, so
-- selectivity doesn't degrade as settled tickets accumulate. The sweep repeats
-- this exact clause top-level so the planner proves the index applies.
CREATE INDEX "tickets_sla_unsettled_idx" ON "tickets" ("id")
	WHERE sla_applied IS NOT NULL
	  AND ((sla_applied ->> 'resolvedAt') IS NULL);
