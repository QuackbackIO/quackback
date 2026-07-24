-- Two read-path indexes surfaced by a data-layer performance audit. Both are
-- idempotent (IF NOT EXISTS) so re-runs on long-lived dev databases no-op.
--
-- 1. user.name trigram GIN index. The admin people-search runs
--       WHERE name ILIKE '%term%'
--    (users/user.service.ts, principal.service.ts). A leading-wildcard ILIKE
--    cannot use a btree, so mirror the existing principal_display_name_trgm_idx
--    with a gin_trgm_ops index. This CREATE is the fresh-install / ledger copy;
--    on an existing large "user" table the real build runs CONCURRENTLY from
--    migrate.ts's ensureConcurrentIndexes (same dual pattern as the other two
--    trgm indexes, 0139/0209), so the IF NOT EXISTS here simply confirms it.
--
-- 2. conversation_messages unread-count partial index. The inbox list's batched
--    unread query (conversation.query.ts) counts visitor-authored, non-internal,
--    live messages per conversation, comparing created_at against the agent's
--    last-read watermark. The partial predicate matches those fixed filters
--    exactly, keeping the index to the relevant sliver; (conversation_id,
--    created_at) serves both the IN grouping and the watermark range check. Built
--    as a plain btree in the transactional path, matching how the sibling
--    conversation_messages_style_mining_idx partial index (0173) was created.

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_name_trgm_idx" ON "user" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_unread_count_idx"
	ON "conversation_messages" USING btree ("conversation_id","created_at")
	WHERE "sender_type" = 'visitor' AND "deleted_at" IS NULL AND "is_internal" = false;
