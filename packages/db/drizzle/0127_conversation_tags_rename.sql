-- Conversation tags: adopt the feedback tag convention, scoped to conversations.
-- Feedback is `tags` (catalog, type Tag) + `post_tags` (join). Mirror the entity:
-- the chat_tags catalog becomes `conversation_tags` (type ConversationTag, exactly
-- like tags/Tag). The existing conversation_tags JOIN becomes
-- `conversation_tag_assignments` (the `_assignments` junction convention, like
-- principal_role_assignments) because the entity is self-referential and cannot
-- reuse `conversation_tags` for both catalog and join.
--
-- Metadata-only renames; no row/id rewrite. The `chat_tag` TypeID prefix is
-- unchanged here (the stored-id prefix flip is a separate, later migration).

-- 1. Move the existing join out of the way (it currently holds `conversation_tags`).
ALTER TABLE "conversation_tags" RENAME TO "conversation_tag_assignments";
ALTER TABLE "conversation_tag_assignments" RENAME COLUMN "chat_tag_id" TO "conversation_tag_id";
ALTER INDEX "conversation_tags_pk" RENAME TO "conversation_tag_assignments_pk";
ALTER INDEX "conversation_tags_chat_tag_idx" RENAME TO "conversation_tag_assignments_tag_idx";

-- 2. Rename the tag catalog into the freed name.
ALTER TABLE "chat_tags" RENAME TO "conversation_tags";
ALTER INDEX "chat_tags_deleted_at_idx" RENAME TO "conversation_tags_deleted_at_idx";
