-- Propose-retry idempotency (P2-C review S1): a synthesis retry can re-run a
-- write tool whose first attempt already proposed, duplicating the pending
-- action row and its announcing internal note. `idempotency_key` mirrors
-- assistant_tool_calls' column (same conversationId:latestCustomerMessageId:
-- toolName:hash(args) shape); proposePendingAction claims it via
-- INSERT ... ON CONFLICT DO NOTHING, same pattern as claimToolCall.
--
-- The unique index is scoped to `status = 'proposed'`, narrower than
-- assistant_tool_calls' key-alone index: a copilot turn has no customer
-- message to key off and always threads latestCustomerMessageId: null, so
-- two unrelated copilot turns proposing the same tool with the same args
-- mint the identical key. Scoping to `status = 'proposed'` means that
-- collision only dedupes while the earlier proposal is still live (the
-- retry case this exists for); once it is approved, rejected, expired, or
-- executed, the key is free again for an unrelated new proposal.
ALTER TABLE "assistant_pending_actions" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_pending_actions_idempotency_key_idx"
	ON "assistant_pending_actions" USING btree ("idempotency_key")
	WHERE "idempotency_key" IS NOT NULL AND "status" = 'proposed';
