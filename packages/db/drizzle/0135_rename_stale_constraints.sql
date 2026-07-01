-- Naming cleanup after the post_*/conversation_* table renames (0127-0134).
-- Those migrations renamed the tables and their explicit secondary indexes but
-- left the AUTO-generated constraints (primary keys, unique + foreign keys) and
-- one stray index carrying the old table-name prefixes. Purely cosmetic - the
-- constraints enforce and reference correctly by OID - but the names drifted
-- from the schema, so a future hand-written migration referencing them by their
-- expected new name would fail. This renames them to match the current tables.
-- Postgres-generated NOT NULL constraints (`<table>_<col>_not_null`) are left as
-- is: Drizzle neither names nor tracks them.

-- conversation_messages (was chat_messages)
ALTER TABLE "conversation_messages" RENAME CONSTRAINT "chat_messages_pkey" TO "conversation_messages_pkey";
ALTER TABLE "conversation_messages" RENAME CONSTRAINT "chat_messages_conversation_id_fkey" TO "conversation_messages_conversation_id_fkey";
ALTER TABLE "conversation_messages" RENAME CONSTRAINT "chat_messages_principal_id_fkey" TO "conversation_messages_principal_id_fkey";
ALTER TABLE "conversation_messages" RENAME CONSTRAINT "chat_messages_deleted_by_principal_id_fkey" TO "conversation_messages_deleted_by_principal_id_fkey";
ALTER INDEX "chat_messages_email_message_id_idx" RENAME TO "conversation_messages_email_message_id_idx";

-- conversation_message_mentions (was chat_message_mentions)
ALTER TABLE "conversation_message_mentions" RENAME CONSTRAINT "chat_message_mentions_pkey" TO "conversation_message_mentions_pkey";
ALTER TABLE "conversation_message_mentions" RENAME CONSTRAINT "chat_message_mentions_chat_message_id_fkey" TO "conversation_message_mentions_conversation_message_id_fkey";
ALTER TABLE "conversation_message_mentions" RENAME CONSTRAINT "chat_message_mentions_principal_id_fkey" TO "conversation_message_mentions_principal_id_fkey";

-- conversation_message_reactions (was chat_message_reactions)
ALTER TABLE "conversation_message_reactions" RENAME CONSTRAINT "chat_message_reactions_pkey" TO "conversation_message_reactions_pkey";
ALTER TABLE "conversation_message_reactions" RENAME CONSTRAINT "chat_message_reactions_chat_message_id_fkey" TO "conversation_message_reactions_conversation_message_id_fkey";
ALTER TABLE "conversation_message_reactions" RENAME CONSTRAINT "chat_message_reactions_principal_id_fkey" TO "conversation_message_reactions_principal_id_fkey";

-- conversation_message_flags (was chat_message_flags)
ALTER TABLE "conversation_message_flags" RENAME CONSTRAINT "chat_message_flags_pkey" TO "conversation_message_flags_pkey";
ALTER TABLE "conversation_message_flags" RENAME CONSTRAINT "chat_message_flags_chat_message_id_fkey" TO "conversation_message_flags_conversation_message_id_fkey";
ALTER TABLE "conversation_message_flags" RENAME CONSTRAINT "chat_message_flags_principal_id_fkey" TO "conversation_message_flags_principal_id_fkey";

-- conversation_tags catalog (was chat_tags)
ALTER TABLE "conversation_tags" RENAME CONSTRAINT "chat_tags_pkey" TO "conversation_tags_pkey";
ALTER TABLE "conversation_tags" RENAME CONSTRAINT "chat_tags_name_key" TO "conversation_tags_name_key";

-- conversation_tag_assignments join (constraints kept the old join-table prefix
-- `conversation_tags`, which is now the catalog table name)
ALTER TABLE "conversation_tag_assignments" RENAME CONSTRAINT "conversation_tags_conversation_id_fkey" TO "conversation_tag_assignments_conversation_id_fkey";
ALTER TABLE "conversation_tag_assignments" RENAME CONSTRAINT "conversation_tags_chat_tag_id_fkey" TO "conversation_tag_assignments_conversation_tag_id_fkey";

-- post_comments (was comments)
ALTER TABLE "post_comments" RENAME CONSTRAINT "comments_pkey" TO "post_comments_pkey";
ALTER TABLE "post_comments" RENAME CONSTRAINT "comments_post_id_posts_id_fk" TO "post_comments_post_id_posts_id_fk";
ALTER TABLE "post_comments" RENAME CONSTRAINT "comments_principal_id_principal_id_fk" TO "post_comments_principal_id_principal_id_fk";
ALTER TABLE "post_comments" RENAME CONSTRAINT "comments_deleted_by_principal_id_principal_id_fk" TO "post_comments_deleted_by_principal_id_principal_id_fk";
ALTER TABLE "post_comments" RENAME CONSTRAINT "comments_status_change_from_id_post_statuses_id_fk" TO "post_comments_status_change_from_id_post_statuses_id_fk";
ALTER TABLE "post_comments" RENAME CONSTRAINT "comments_status_change_to_id_post_statuses_id_fk" TO "post_comments_status_change_to_id_post_statuses_id_fk";

-- post_votes (was votes)
ALTER TABLE "post_votes" RENAME CONSTRAINT "votes_pkey" TO "post_votes_pkey";
ALTER TABLE "post_votes" RENAME CONSTRAINT "votes_post_id_posts_id_fk" TO "post_votes_post_id_posts_id_fk";
ALTER TABLE "post_votes" RENAME CONSTRAINT "votes_principal_id_principal_id_fk" TO "post_votes_principal_id_principal_id_fk";
ALTER TABLE "post_votes" RENAME CONSTRAINT "votes_added_by_principal_id_fkey" TO "post_votes_added_by_principal_id_fkey";
ALTER TABLE "post_votes" RENAME CONSTRAINT "votes_feedback_suggestion_id_feedback_suggestions_id_fk" TO "post_votes_feedback_suggestion_id_feedback_suggestions_id_fk";

-- post_comment_reactions (was comment_reactions)
ALTER TABLE "post_comment_reactions" RENAME CONSTRAINT "comment_reactions_pkey" TO "post_comment_reactions_pkey";
ALTER TABLE "post_comment_reactions" RENAME CONSTRAINT "comment_reactions_comment_id_comments_id_fk" TO "post_comment_reactions_comment_id_post_comments_id_fk";
ALTER TABLE "post_comment_reactions" RENAME CONSTRAINT "comment_reactions_principal_id_principal_id_fk" TO "post_comment_reactions_principal_id_principal_id_fk";

-- post_comment_edit_history (was comment_edit_history)
ALTER TABLE "post_comment_edit_history" RENAME CONSTRAINT "comment_edit_history_pkey" TO "post_comment_edit_history_pkey";
ALTER TABLE "post_comment_edit_history" RENAME CONSTRAINT "comment_edit_history_comment_id_comments_id_fk" TO "post_comment_edit_history_comment_id_post_comments_id_fk";
ALTER TABLE "post_comment_edit_history" RENAME CONSTRAINT "comment_edit_history_editor_principal_id_principal_id_fk" TO "post_comment_edit_history_editor_principal_id_principal_id_fk";

-- post_tags catalog (was tags)
ALTER TABLE "post_tags" RENAME CONSTRAINT "tags_pkey" TO "post_tags_pkey";
ALTER TABLE "post_tags" RENAME CONSTRAINT "tags_name_unique" TO "post_tags_name_unique";

-- in_app_notifications: FK name referenced the old `comments` table it points at
ALTER TABLE "in_app_notifications" RENAME CONSTRAINT "in_app_notifications_comment_id_comments_id_fk" TO "in_app_notifications_comment_id_post_comments_id_fk";
