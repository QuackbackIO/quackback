-- Index tuning from a schema-wide audit: (a) index foreign-key columns that
-- Postgres does not index automatically, (b) drop indexes whose columns are a
-- strict prefix of another index on the same table (with an identical or
-- absent predicate), so the composite already serves every query the
-- single-column index could.
--
-- The adds fall in two groups:
--   1. Hot query paths that filter on the FK (team inbox, workflow run
--      timelines, assistant event feeds, pipeline debugging).
--   2. Mostly-null audit/attribution columns on the largest tables
--      (deleted_by / merged_by / added_by / editor / blocked_by). These are
--      never filtered on directly, but every DELETE on the referenced row
--      (principal sweeps, account deletion, suggestion cleanup) triggers a
--      referential-integrity lookup per referencing table — without an index
--      that is a sequential scan per deleted row. Partial WHERE col IS NOT
--      NULL keeps them tiny; the RI lookup is a strict equality, which the
--      planner proves implies IS NOT NULL, so the partial index still serves
--      it.
--
-- All plain btree builds (fast even on large tables), so they run in the
-- normal transactional migration path rather than the concurrent-index path
-- in migrate.ts.

-- 1. Hot-path FK indexes
CREATE INDEX IF NOT EXISTS "tickets_assignee_team_idx" ON "tickets" ("assignee_team_id") WHERE "assignee_team_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_idx" ON "workflow_runs" ("workflow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_events_run_idx" ON "workflow_run_events" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_events_conversation_idx" ON "assistant_events" ("conversation_id") WHERE "conversation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_events_ticket_idx" ON "assistant_events" ("ticket_id") WHERE "ticket_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_log_signal_idx" ON "pipeline_log" ("signal_id") WHERE "signal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_log_suggestion_idx" ON "pipeline_log" ("suggestion_id") WHERE "suggestion_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_log_post_idx" ON "pipeline_log" ("post_id") WHERE "post_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "in_app_notifications_comment_idx" ON "in_app_notifications" ("comment_id") WHERE "comment_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_suggestions_board_id_idx" ON "feedback_suggestions" ("board_id");
--> statement-breakpoint
-- OAuth token tables: session logout/expiry and refresh-token rotation delete
-- referenced rows constantly; each delete RI-checks these columns.
CREATE INDEX IF NOT EXISTS "oauth_access_token_session_id_idx" ON "oauth_access_token" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_user_id_idx" ON "oauth_access_token" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_refresh_id_idx" ON "oauth_access_token" ("refresh_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_session_id_idx" ON "oauth_refresh_token" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_user_id_idx" ON "oauth_refresh_token" ("user_id");
--> statement-breakpoint

-- 2. Audit/attribution columns on large tables (RI-lookup protection)
CREATE INDEX IF NOT EXISTS "posts_deleted_by_principal_idx" ON "posts" ("deleted_by_principal_id") WHERE "deleted_by_principal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_merged_by_principal_idx" ON "posts" ("merged_by_principal_id") WHERE "merged_by_principal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_comments_deleted_by_principal_idx" ON "post_comments" ("deleted_by_principal_id") WHERE "deleted_by_principal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_votes_added_by_principal_idx" ON "post_votes" ("added_by_principal_id") WHERE "added_by_principal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_votes_feedback_suggestion_idx" ON "post_votes" ("feedback_suggestion_id") WHERE "feedback_suggestion_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_deleted_by_principal_idx" ON "conversation_messages" ("deleted_by_principal_id") WHERE "deleted_by_principal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_edit_history_editor_principal_idx" ON "post_edit_history" ("editor_principal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_comment_edit_history_editor_principal_idx" ON "post_comment_edit_history" ("editor_principal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "principal_blocked_by_idx" ON "principal" ("blocked_by_principal_id") WHERE "blocked_by_principal_id" IS NOT NULL;
--> statement-breakpoint

-- 3. Drop prefix-redundant indexes. Each is strictly covered by the index
-- named in its comment (same leading column(s), no narrower predicate).
DROP INDEX IF EXISTS "posts_board_id_idx"; -- posts_board_created_at_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "posts_principal_id_idx"; -- posts_principal_created_at_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "post_comments_post_id_idx"; -- post_comments_post_created_at_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "post_votes_post_id_idx"; -- post_votes_principal_post_idx (unique, post_id leading)
--> statement-breakpoint
DROP INDEX IF EXISTS "post_votes_principal_id_idx"; -- post_votes_principal_created_at_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "session_userId_idx"; -- session_userId_createdAt_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "account_userId_idx"; -- account_userId_createdAt_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "invitation_email_idx"; -- invitation_email_status_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "principal_role_idx"; -- principal_role_created_at_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "kb_articles_category_id_idx"; -- kb_articles_category_position_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "kb_article_feedback_article_id_idx"; -- kb_article_feedback_unique_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "user_segments_principal_id_idx"; -- user_segments_pk
--> statement-breakpoint
DROP INDEX IF EXISTS "post_tag_assignments_post_id_idx"; -- post_tag_assignments_pk
--> statement-breakpoint
DROP INDEX IF EXISTS "changelog_entry_posts_changelog_id_idx"; -- changelog_entry_posts_pk
--> statement-breakpoint
DROP INDEX IF EXISTS "post_subscriptions_post_idx"; -- post_subscriptions_unique
--> statement-breakpoint
DROP INDEX IF EXISTS "post_external_links_post_id_idx"; -- post_external_links_post_status_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "post_external_links_type_external_id_idx"; -- post_external_links_type_external_post_unique
--> statement-breakpoint
DROP INDEX IF EXISTS "ticket_external_links_ticket_id_idx"; -- ticket_external_links_ticket_status_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "post_comment_reactions_comment_id_idx"; -- post_comment_reactions_unique_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_message_reactions_message_idx"; -- conversation_message_reactions_unique_idx
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_integrations_type_status"; -- integration_type_unique already makes the leading column unique
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_slack_monitors_lookup"; -- slack_monitor_channel_unique
