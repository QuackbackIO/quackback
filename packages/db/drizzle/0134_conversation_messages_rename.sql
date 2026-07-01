-- Conversation messages vertical: chat_messages and its child tables adopt the
-- conversation_message* naming (matching the `conversations` object). Metadata-
-- only renames. The chat_msg / chat_msg_mention TypeID prefixes were later
-- flipped code-only to conversation_msg / conversation_msg_mention with NO
-- stored-id pass (TypeIDs persist as native uuid, prefix is app-layer only).

ALTER TABLE "chat_messages" RENAME TO "conversation_messages";
ALTER INDEX "chat_messages_conversation_created_idx" RENAME TO "conversation_messages_conversation_created_idx";
ALTER INDEX "chat_messages_principal_idx" RENAME TO "conversation_messages_principal_idx";
ALTER INDEX "chat_messages_created_at_idx" RENAME TO "conversation_messages_created_at_idx";

ALTER TABLE "chat_message_mentions" RENAME TO "conversation_message_mentions";
ALTER TABLE "conversation_message_mentions" RENAME COLUMN "chat_message_id" TO "conversation_message_id";
ALTER INDEX "chat_message_mentions_message_principal_uq" RENAME TO "conversation_message_mentions_message_principal_uq";
ALTER INDEX "chat_message_mentions_principal_idx" RENAME TO "conversation_message_mentions_principal_idx";

ALTER TABLE "chat_message_reactions" RENAME TO "conversation_message_reactions";
ALTER TABLE "conversation_message_reactions" RENAME COLUMN "chat_message_id" TO "conversation_message_id";
ALTER INDEX "chat_message_reactions_message_idx" RENAME TO "conversation_message_reactions_message_idx";
ALTER INDEX "chat_message_reactions_principal_idx" RENAME TO "conversation_message_reactions_principal_idx";
ALTER INDEX "chat_message_reactions_unique_idx" RENAME TO "conversation_message_reactions_unique_idx";

ALTER TABLE "chat_message_flags" RENAME TO "conversation_message_flags";
ALTER TABLE "conversation_message_flags" RENAME COLUMN "chat_message_id" TO "conversation_message_id";
ALTER INDEX "chat_message_flags_principal_idx" RENAME TO "conversation_message_flags_principal_idx";
