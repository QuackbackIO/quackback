-- @contract: additive
-- Ticket due dates: the inbox "Due date" sort and filters, and the due-soon /
-- overdue alerts. tickets.due_at already exists (0150) and becomes the one
-- shared due date a customer can propose and a teammate can set; it is
-- independent of SLA targets, which live in sla_applied.
--
-- This adds the two alert markers the ticket-due sweep claims. Each holds the
-- due_at value it last alerted for, so moving the due date re-arms both
-- alerts without a reset write. It also adds two indexes:
-- tickets_due_at_id_idx backs the keyset sort (due_at ASC NULLS LAST, id ASC
-- is the btree default order), and the partial tickets_due_alert_pending_idx
-- is the sweep and deadline-provider candidate set. Both queries repeat its
-- predicate verbatim so the planner can prove it applies, and it stays bounded
-- to open tickets whose overdue alert has not fired for their current date.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "due_soon_notified_for" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "overdue_notified_for" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_due_at_id_idx" ON "tickets" USING btree ("due_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_due_alert_pending_idx" ON "tickets" USING btree ("due_at")
  WHERE "due_at" IS NOT NULL AND "resolved_at" IS NULL AND "deleted_at" IS NULL
    AND "overdue_notified_for" IS DISTINCT FROM "due_at";
