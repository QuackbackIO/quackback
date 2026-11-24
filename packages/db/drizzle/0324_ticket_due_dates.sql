-- @contract: additive
-- Ticket due dates: the inbox "Due date" sort and filters, and the due-soon /
-- overdue alerts. tickets.due_at already exists (0150) and becomes the one
-- shared due date a customer can propose and a teammate can set; it is
-- independent of SLA targets, which live in sla_applied.
--
-- This adds the two alert markers the ticket-due sweep claims. Each holds the
-- due_at value it last alerted for, so moving the due date re-arms both
-- alerts without a reset write. Two nullable columns with no default, so no
-- table rewrite. tickets is a large table, so the two indexes the due sort
-- and the sweep read (tickets_due_at_id_idx, tickets_due_alert_pending_idx)
-- are built CONCURRENTLY before the server listens, from
-- CONCURRENT_INDEX_SPECS in packages/db/src/schema-ops.ts, not here.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "due_soon_notified_for" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "overdue_notified_for" timestamp with time zone;
