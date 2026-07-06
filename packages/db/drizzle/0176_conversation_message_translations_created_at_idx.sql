-- Backs the 180-day retention sweep for conversation_message_translations
-- (cleanupExpiredMessageTranslations, conversation-translation.service.ts),
-- mirroring assistant_tool_calls_created_at_idx's plain created_at index for
-- the same DELETE ... WHERE created_at < cutoff shape.
CREATE INDEX "conversation_message_translations_created_at_idx" ON "conversation_message_translations" USING btree ("created_at");
