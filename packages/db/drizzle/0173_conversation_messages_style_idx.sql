-- The `my_tone` copilot transform mines a teammate's own past replies
-- (copilot-transform.ts's fetchTeammateStyleExcerpts): principal_id +
-- sender_type = 'agent' + is_internal = false + deleted_at IS NULL, ordered
-- by created_at DESC, LIMIT 10. Only principal_id is indexed today
-- (conversation_messages_principal_idx); this partial index matches the
-- query's predicates and sort order exactly.
CREATE INDEX "conversation_messages_style_mining_idx"
	ON "conversation_messages" USING btree ("principal_id","created_at" DESC)
	WHERE "sender_type" = 'agent' AND "is_internal" = false AND "deleted_at" IS NULL;
