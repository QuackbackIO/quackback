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
