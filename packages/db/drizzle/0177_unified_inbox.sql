-- Unified inbox (§3.3): tickets gain their own read-receipt watermarks,
-- mirroring conversations.visitor_last_read_at/agent_last_read_at, plus the
-- two keyset-pagination indexes conversations already have (last-activity and
-- created-at feeds) so the unified list endpoint can page tickets and
-- conversations through the same cursor shape.
--
-- The backfill treats closed history as read: an already-resolved ticket
-- never lights up as unread on migration day, while every still-open ticket
-- starts "unread since its last activity" — honest, since there is no real
-- prior watermark to backfill from.
ALTER TABLE "tickets" ADD COLUMN "requester_last_read_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "assignee_last_read_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "tickets" SET "assignee_last_read_at" = "updated_at", "requester_last_read_at" = "updated_at" WHERE "resolved_at" IS NOT NULL;
--> statement-breakpoint
-- Keyset pagination for the unified inbox list, mirroring
-- conversations_last_message_at_id_idx / conversations_created_at_id_idx.
CREATE INDEX "tickets_updated_at_id_idx" ON "tickets" USING btree ("updated_at" DESC, "id");
--> statement-breakpoint
CREATE INDEX "tickets_created_at_id_idx" ON "tickets" USING btree ("created_at", "id");
--> statement-breakpoint
-- Pending actions become polymorphic like conversation_messages
-- (conversation_messages_parent_check, 0151): Quinn can now propose a
-- write-tool call from a ticket-scoped copilot turn, not just a conversation.
ALTER TABLE "assistant_pending_actions" ALTER COLUMN "conversation_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN "ticket_id" uuid;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions"
	ADD CONSTRAINT "assistant_pending_actions_ticket_id_tickets_id_fk"
	FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Exactly one parent: a pending action belongs to a conversation XOR a ticket.
ALTER TABLE "assistant_pending_actions"
	ADD CONSTRAINT "assistant_pending_actions_parent_check"
	CHECK (num_nonnulls("conversation_id", "ticket_id") = 1);
--> statement-breakpoint
-- Replace the conversation-only proposed-status partial with two per-parent
-- partials now that ticket_id exists. The conversation index keeps its name
-- (dropped and recreated with a narrower predicate, since Postgres can't ALTER
-- an index's WHERE clause in place); the ticket index is new and distinctly named.
DROP INDEX "assistant_pending_actions_conversation_proposed_idx";
--> statement-breakpoint
CREATE INDEX "assistant_pending_actions_conversation_proposed_idx"
	ON "assistant_pending_actions" USING btree ("conversation_id")
	WHERE "status" = 'proposed' AND "conversation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "assistant_pending_actions_ticket_proposed_idx"
	ON "assistant_pending_actions" USING btree ("ticket_id")
	WHERE "status" = 'proposed' AND "ticket_id" IS NOT NULL;
