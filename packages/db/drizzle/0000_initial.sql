-- Extensions (pg_cron requires shared_preload_libraries config, skip if unavailable)
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron not available, skipping'; END $$;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_time_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_key" text,
	"favicon_key" text,
	"header_logo_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	"auth_config" text,
	"portal_config" text,
	"branding_config" text,
	"custom_css" text,
	"header_display_mode" text DEFAULT 'logo_and_name',
	"header_display_name" text,
	"setup_state" text,
	CONSTRAINT "settings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"image_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "boards_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "roadmaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "roadmaps_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "post_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"category" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"show_on_roadmap" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "post_statuses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "comment_edit_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"editor_member_id" uuid NOT NULL,
	"previous_content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"parent_id" uuid,
	"member_id" uuid,
	"author_id" text,
	"author_name" text,
	"author_email" text,
	"content" text NOT NULL,
	"is_team_member" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "post_edit_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"editor_member_id" uuid NOT NULL,
	"previous_title" text NOT NULL,
	"previous_content" text NOT NULL,
	"previous_content_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"member_id" uuid,
	"author_name" text,
	"author_email" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_roadmaps" (
	"post_id" uuid NOT NULL,
	"roadmap_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_json" jsonb,
	"member_id" uuid,
	"author_id" text,
	"author_name" text,
	"author_email" text,
	"status_id" uuid,
	"owner_member_id" uuid,
	"owner_id" text,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"official_response" text,
	"official_response_member_id" uuid,
	"official_response_author_id" text,
	"official_response_author_name" text,
	"official_response_at" timestamp with time zone,
	"pinned_comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_member_id" uuid,
	"moderation_state" text DEFAULT 'published' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')) STORED,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_updated_at" timestamp with time zone,
	CONSTRAINT "vote_count_non_negative" CHECK (vote_count >= 0),
	CONSTRAINT "comment_count_non_negative" CHECK (comment_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_event_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filters" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_unique" UNIQUE("integration_id","event_type","action_type")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"secrets" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_workspace_id" varchar(255),
	"external_workspace_name" varchar(255),
	"connected_by_member_id" uuid,
	"connected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_type_unique" UNIQUE("integration_type"),
	CONSTRAINT "error_count_non_negative" CHECK (error_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "changelog_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_json" jsonb,
	"member_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "changelog_entry_posts" (
	"changelog_entry_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"post_id" uuid,
	"comment_id" uuid,
	"metadata" jsonb,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"email_status_change" boolean DEFAULT true NOT NULL,
	"email_new_comment" boolean DEFAULT true NOT NULL,
	"email_muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_member_id_unique" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "post_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" varchar(20) NOT NULL,
	"notify_comments" boolean DEFAULT true NOT NULL,
	"notify_status_changes" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unsubscribe_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"member_id" uuid NOT NULL,
	"post_id" uuid,
	"action" varchar(30) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unsubscribe_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "post_sentiment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"sentiment" text NOT NULL,
	"confidence" real NOT NULL,
	"model" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	CONSTRAINT "post_sentiment_post_id_unique" UNIQUE("post_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"created_by_id" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_by_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"board_ids" text[],
	"status" text DEFAULT 'active' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_token" ADD CONSTRAINT "one_time_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_edit_history" ADD CONSTRAINT "comment_edit_history_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_edit_history" ADD CONSTRAINT "comment_edit_history_editor_member_id_member_id_fk" FOREIGN KEY ("editor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_edit_history" ADD CONSTRAINT "post_edit_history_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_edit_history" ADD CONSTRAINT "post_edit_history_editor_member_id_member_id_fk" FOREIGN KEY ("editor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_id_post_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."post_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_owner_member_id_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_official_response_member_id_member_id_fk" FOREIGN KEY ("official_response_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_deleted_by_member_id_member_id_fk" FOREIGN KEY ("deleted_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_mappings" ADD CONSTRAINT "event_mappings_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_connected_by_member_id_member_id_fk" FOREIGN KEY ("connected_by_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD CONSTRAINT "changelog_entries_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry_posts" ADD CONSTRAINT "changelog_entry_posts_changelog_entry_id_changelog_entries_id_fk" FOREIGN KEY ("changelog_entry_id") REFERENCES "public"."changelog_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entry_posts" ADD CONSTRAINT "changelog_entry_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_subscriptions" ADD CONSTRAINT "post_subscriptions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_subscriptions" ADD CONSTRAINT "post_subscriptions_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_sentiment" ADD CONSTRAINT "post_sentiment_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_member_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_id_member_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_email_status_idx" ON "invitation" USING btree ("email","status");--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "member_role_idx" ON "member" USING btree ("role");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "boards_is_public_idx" ON "boards" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "boards_deleted_at_idx" ON "boards" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "roadmaps_position_idx" ON "roadmaps" USING btree ("position");--> statement-breakpoint
CREATE INDEX "roadmaps_is_public_idx" ON "roadmaps" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "roadmaps_deleted_at_idx" ON "roadmaps" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "tags_deleted_at_idx" ON "tags" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "post_statuses_position_idx" ON "post_statuses" USING btree ("category","position");--> statement-breakpoint
CREATE INDEX "post_statuses_deleted_at_idx" ON "post_statuses" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "comment_edit_history_comment_id_idx" ON "comment_edit_history" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_edit_history_created_at_idx" ON "comment_edit_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_id_idx" ON "comment_reactions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_reactions_member_id_idx" ON "comment_reactions" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_unique_idx" ON "comment_reactions" USING btree ("comment_id","member_id","emoji");--> statement-breakpoint
CREATE INDEX "comments_post_id_idx" ON "comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "comments_parent_id_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_member_id_idx" ON "comments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "comments_created_at_idx" ON "comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comments_post_created_at_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_edit_history_post_id_idx" ON "post_edit_history" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_edit_history_created_at_idx" ON "post_edit_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "post_notes_post_id_idx" ON "post_notes" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_notes_member_id_idx" ON "post_notes" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "post_notes_created_at_idx" ON "post_notes" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_roadmaps_pk" ON "post_roadmaps" USING btree ("post_id","roadmap_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_post_id_idx" ON "post_roadmaps" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_roadmap_id_idx" ON "post_roadmaps" USING btree ("roadmap_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_position_idx" ON "post_roadmaps" USING btree ("roadmap_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "post_tags_pk" ON "post_tags" USING btree ("post_id","tag_id");--> statement-breakpoint
CREATE INDEX "post_tags_post_id_idx" ON "post_tags" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_tags_tag_id_idx" ON "post_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "posts_board_id_idx" ON "posts" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "posts_status_id_idx" ON "posts" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "posts_member_id_idx" ON "posts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "posts_owner_member_id_idx" ON "posts" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "posts_owner_id_idx" ON "posts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "posts_created_at_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "posts_vote_count_idx" ON "posts" USING btree ("vote_count");--> statement-breakpoint
CREATE INDEX "posts_board_vote_idx" ON "posts" USING btree ("board_id","vote_count");--> statement-breakpoint
CREATE INDEX "posts_board_created_at_idx" ON "posts" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_board_status_idx" ON "posts" USING btree ("board_id","status_id");--> statement-breakpoint
CREATE INDEX "posts_member_created_at_idx" ON "posts" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_with_status_idx" ON "posts" USING btree ("status_id","vote_count") WHERE status_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_search_vector_idx" ON "posts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "posts_deleted_at_idx" ON "posts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "posts_board_deleted_at_idx" ON "posts" USING btree ("board_id","deleted_at");--> statement-breakpoint
CREATE INDEX "posts_moderation_state_idx" ON "posts" USING btree ("moderation_state");--> statement-breakpoint
CREATE INDEX "posts_pinned_comment_id_idx" ON "posts" USING btree ("pinned_comment_id");--> statement-breakpoint
CREATE INDEX "votes_post_id_idx" ON "votes" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_member_post_idx" ON "votes" USING btree ("post_id","member_id");--> statement-breakpoint
CREATE INDEX "votes_member_id_idx" ON "votes" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "votes_member_created_at_idx" ON "votes" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_event_mappings_lookup" ON "integration_event_mappings" USING btree ("integration_id","event_type","enabled");--> statement-breakpoint
CREATE INDEX "idx_integrations_type_status" ON "integrations" USING btree ("integration_type","status");--> statement-breakpoint
CREATE INDEX "changelog_published_at_idx" ON "changelog_entries" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "changelog_member_id_idx" ON "changelog_entries" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "changelog_deleted_at_idx" ON "changelog_entries" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_entry_posts_pk" ON "changelog_entry_posts" USING btree ("changelog_entry_id","post_id");--> statement-breakpoint
CREATE INDEX "changelog_entry_posts_changelog_id_idx" ON "changelog_entry_posts" USING btree ("changelog_entry_id");--> statement-breakpoint
CREATE INDEX "changelog_entry_posts_post_id_idx" ON "changelog_entry_posts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "in_app_notifications_member_created_idx" ON "in_app_notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "in_app_notifications_member_unread_idx" ON "in_app_notifications" USING btree ("member_id") WHERE read_at IS NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "in_app_notifications_post_idx" ON "in_app_notifications" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_subscriptions_unique" ON "post_subscriptions" USING btree ("post_id","member_id");--> statement-breakpoint
CREATE INDEX "post_subscriptions_member_idx" ON "post_subscriptions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "post_subscriptions_post_idx" ON "post_subscriptions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_subscriptions_post_comments_idx" ON "post_subscriptions" USING btree ("post_id") WHERE notify_comments = true;--> statement-breakpoint
CREATE INDEX "post_subscriptions_post_status_idx" ON "post_subscriptions" USING btree ("post_id") WHERE notify_status_changes = true;--> statement-breakpoint
CREATE INDEX "unsubscribe_tokens_member_idx" ON "unsubscribe_tokens" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "post_sentiment_processed_at_idx" ON "post_sentiment" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "post_sentiment_sentiment_idx" ON "post_sentiment" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "api_keys_created_by_id_idx" ON "api_keys" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "api_keys_revoked_at_idx" ON "api_keys" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "webhooks_status_idx" ON "webhooks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhooks_created_by_id_idx" ON "webhooks" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "webhooks_deleted_at_idx" ON "webhooks" USING btree ("deleted_at");