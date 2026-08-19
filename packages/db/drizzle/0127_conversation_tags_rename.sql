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
--> statement-breakpoint
-- Feedback tags: rename the post<->tag JOIN from post_tags to
-- post_tag_assignments, matching the `_assignments` junction convention
-- (principal_role_assignments) and the conversation side
-- (conversation_tag_assignments). This removes the ambiguity where `*_tags`
-- meant a JOIN for feedback but a CATALOG for conversations: after this,
-- `*_tags` is always a catalog and `*_tag_assignments` is always the join.
--
-- The `tags` catalog and the `tag` TypeID prefix are unchanged. Metadata-only
-- renames; no row/id rewrite.

ALTER TABLE "post_tags" RENAME TO "post_tag_assignments";
ALTER INDEX "post_tags_pk" RENAME TO "post_tag_assignments_pk";
ALTER INDEX "post_tags_post_id_idx" RENAME TO "post_tag_assignments_post_id_idx";
ALTER INDEX "post_tags_tag_id_idx" RENAME TO "post_tag_assignments_tag_id_idx";
--> statement-breakpoint
-- Feedback tags: rename the base `tags` catalog to `post_tags`, so both taggable
-- entities share ONE convention: `<entity>_tags` = tag catalog, and
-- `<entity>_tag_assignments` = the tag<->entity junction. Result:
--   posts:         post_tags        + post_tag_assignments
--   conversations: conversation_tags + conversation_tag_assignments
--
-- `post_tags` is free because migration 0128 renamed the old post_tags JOIN to
-- post_tag_assignments. Metadata-only rename; the `tag` TypeID prefix is
-- unchanged (the stored-id prefix flip is a later, separate migration).

ALTER TABLE "tags" RENAME TO "post_tags";
ALTER INDEX "tags_deleted_at_idx" RENAME TO "post_tags_deleted_at_idx";
--> statement-breakpoint
-- Post-child object symmetry: reactions on post comments become
-- post_comment_reactions (parent chain: posts -> comments -> reactions), matching
-- the post-prefixed sibling tables (post_notes, post_roadmaps, post_edit_history).
-- Metadata-only rename. The `reaction` TypeID prefix was later split code-only
-- (post_comment_reaction / conversation_msg_reaction) with NO stored-id pass:
-- TypeIDs persist as native uuid, so the prefix lives only in the app layer.

ALTER TABLE "comment_reactions" RENAME TO "post_comment_reactions";
ALTER INDEX "comment_reactions_comment_id_idx" RENAME TO "post_comment_reactions_comment_id_idx";
ALTER INDEX "comment_reactions_principal_id_idx" RENAME TO "post_comment_reactions_principal_id_idx";
ALTER INDEX "comment_reactions_unique_idx" RENAME TO "post_comment_reactions_unique_idx";
--> statement-breakpoint
-- Post-child object symmetry: comment_edit_history -> post_comment_edit_history
-- (parent chain posts -> comments -> edit history). Metadata-only rename. The
-- `comment_edit` TypeID prefix was later flipped code-only to post_comment_edit
-- with NO stored-id pass (TypeIDs persist as native uuid, prefix is app-layer only).

ALTER TABLE "comment_edit_history" RENAME TO "post_comment_edit_history";
ALTER INDEX "comment_edit_history_comment_id_idx" RENAME TO "post_comment_edit_history_comment_id_idx";
ALTER INDEX "comment_edit_history_created_at_idx" RENAME TO "post_comment_edit_history_created_at_idx";
--> statement-breakpoint
-- Post-child object symmetry: votes -> post_votes (posts -> votes). Matches the
-- post-prefixed sibling tables. Metadata-only rename. The `vote` TypeID prefix
-- was later flipped code-only to post_vote with NO stored-id pass (TypeIDs
-- persist as native uuid, so the prefix lives only in the app layer).

ALTER TABLE "votes" RENAME TO "post_votes";
ALTER INDEX "votes_post_id_idx" RENAME TO "post_votes_post_id_idx";
ALTER INDEX "votes_principal_post_idx" RENAME TO "post_votes_principal_post_idx";
ALTER INDEX "votes_principal_id_idx" RENAME TO "post_votes_principal_id_idx";
ALTER INDEX "votes_principal_created_at_idx" RENAME TO "post_votes_principal_created_at_idx";
ALTER INDEX "votes_source_type_idx" RENAME TO "post_votes_source_type_idx";
--> statement-breakpoint
-- Post-child object symmetry: comments -> post_comments (posts -> comments).
-- Uniform `post*` naming for all post-child tables. Metadata-only rename. The
-- `comment` TypeID prefix was later flipped code-only to post_comment with NO
-- stored-id pass (TypeIDs persist as native uuid, prefix is app-layer only).

ALTER TABLE "comments" RENAME TO "post_comments";
ALTER INDEX "comments_post_id_idx" RENAME TO "post_comments_post_id_idx";
ALTER INDEX "comments_parent_id_idx" RENAME TO "post_comments_parent_id_idx";
ALTER INDEX "comments_principal_id_idx" RENAME TO "post_comments_principal_id_idx";
ALTER INDEX "comments_created_at_idx" RENAME TO "post_comments_created_at_idx";
ALTER INDEX "comments_post_created_at_idx" RENAME TO "post_comments_post_created_at_idx";
ALTER INDEX "comments_moderation_state_idx" RENAME TO "post_comments_moderation_state_idx";
ALTER INDEX "comments_status_change_to_id_idx" RENAME TO "post_comments_status_change_to_id_idx";
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
-- Post-child object symmetry: merge_suggestions -> post_merge_suggestions
-- (posts -> merge_suggestions). Matches the post-prefixed sibling tables
-- (post_votes, post_comments, post_notes). Metadata-only rename that also
-- covers the auto-generated primary key and foreign key constraints in the
-- same migration (0135 pattern), since there is no later cleanup batch for
-- this one-off rename. The `merge_sug` TypeID prefix is flipped code-only to
-- post_merge_sug with NO stored-id pass (TypeIDs persist as native uuid, so
-- the prefix lives only in the app layer).

ALTER TABLE "merge_suggestions" RENAME TO "post_merge_suggestions";
ALTER INDEX "merge_suggestions_source_post_idx" RENAME TO "post_merge_suggestions_source_post_idx";
ALTER INDEX "merge_suggestions_target_post_idx" RENAME TO "post_merge_suggestions_target_post_idx";
ALTER INDEX "merge_suggestions_status_idx" RENAME TO "post_merge_suggestions_status_idx";
ALTER INDEX "merge_suggestions_created_idx" RENAME TO "post_merge_suggestions_created_idx";
ALTER INDEX "merge_suggestions_pending_unique_idx" RENAME TO "post_merge_suggestions_pending_unique_idx";

ALTER TABLE "post_merge_suggestions" RENAME CONSTRAINT "merge_suggestions_pkey" TO "post_merge_suggestions_pkey";
ALTER TABLE "post_merge_suggestions" RENAME CONSTRAINT "merge_suggestions_source_post_id_posts_id_fk" TO "post_merge_suggestions_source_post_id_posts_id_fk";
ALTER TABLE "post_merge_suggestions" RENAME CONSTRAINT "merge_suggestions_target_post_id_posts_id_fk" TO "post_merge_suggestions_target_post_id_posts_id_fk";
ALTER TABLE "post_merge_suggestions" RENAME CONSTRAINT "merge_suggestions_resolved_by_principal_id_principal_id_fk" TO "post_merge_suggestions_resolved_by_principal_id_principal_id_fk";
