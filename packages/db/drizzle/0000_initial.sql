DO $$ BEGIN CREATE ROLE "app_user"; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
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
	"organization_id" uuid NOT NULL,
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
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"logo_blob" "bytea",
	"logo_type" text,
	"favicon_blob" "bytea",
	"favicon_type" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	"auth_config" text,
	"portal_config" text,
	"branding_config" text,
	"custom_css" text,
	"header_logo_blob" "bytea",
	"header_logo_type" text,
	"header_display_mode" text DEFAULT 'logo_and_name',
	"header_display_name" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
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
	"active_organization_id" uuid,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "session_transfer_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"target_domain" text NOT NULL,
	"callback_url" text NOT NULL,
	"context" text DEFAULT 'team' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_transfer_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"provider_id" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"image_blob" "bytea",
	"image_type" text,
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
CREATE TABLE "workspace_domain" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"domain_type" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"verification_token" text,
	"cloudflare_hostname_id" text,
	"ssl_status" text,
	"ownership_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_domain_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roadmaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadmaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"category" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"show_on_roadmap" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_identifier" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
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
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_roadmaps" (
	"post_id" uuid NOT NULL,
	"roadmap_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_roadmaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
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
	"estimated" text,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"official_response" text,
	"official_response_member_id" uuid,
	"official_response_author_id" text,
	"official_response_author_name" text,
	"official_response_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_member_id" uuid,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')) STORED
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_identifier" text NOT NULL,
	"member_id" uuid,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comment_edit_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"editor_member_id" uuid NOT NULL,
	"previous_content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_edit_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_edit_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"editor_member_id" uuid NOT NULL,
	"previous_title" text NOT NULL,
	"previous_content" text NOT NULL,
	"previous_content_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_edit_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "integration_linked_entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_entity_type" varchar(50) NOT NULL,
	"external_entity_id" varchar(255) NOT NULL,
	"external_entity_url" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linked_entity_unique" UNIQUE("integration_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "integration_sync_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"event_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"integration_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
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
	CONSTRAINT "org_integration_unique" UNIQUE("organization_id","integration_type")
);
--> statement-breakpoint
ALTER TABLE "organization_integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "changelog_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" varchar(20) NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_transfer_token" ADD CONSTRAINT "session_transfer_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domain" ADD CONSTRAINT "workspace_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_id_post_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."post_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_owner_member_id_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_official_response_member_id_member_id_fk" FOREIGN KEY ("official_response_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_mappings" ADD CONSTRAINT "event_mappings_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_linked_entities" ADD CONSTRAINT "linked_entities_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_log" ADD CONSTRAINT "sync_log_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integrations" ADD CONSTRAINT "organization_integrations_connected_by_member_id_member_id_fk" FOREIGN KEY ("connected_by_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD CONSTRAINT "changelog_entries_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_subscriptions" ADD CONSTRAINT "post_subscriptions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_subscriptions" ADD CONSTRAINT "post_subscriptions_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_edit_history" ADD CONSTRAINT "comment_edit_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_edit_history" ADD CONSTRAINT "comment_edit_history_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_edit_history" ADD CONSTRAINT "comment_edit_history_editor_member_id_member_id_fk" FOREIGN KEY ("editor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_edit_history" ADD CONSTRAINT "post_edit_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_edit_history" ADD CONSTRAINT "post_edit_history_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_edit_history" ADD CONSTRAINT "post_edit_history_editor_member_id_member_id_fk" FOREIGN KEY ("editor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_deleted_by_member_id_member_id_fk" FOREIGN KEY ("deleted_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_org_email_status_idx" ON "invitation" USING btree ("organization_id","email","status");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_org_idx" ON "member" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "member_org_role_idx" ON "member" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_transfer_token_token_idx" ON "session_transfer_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sso_provider_org_id_idx" ON "sso_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_provider_org_domain_idx" ON "sso_provider" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE INDEX "sso_provider_domain_idx" ON "sso_provider" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_org_idx" ON "user" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "user_org_id_idx" ON "user" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workspace_domain_org_id_idx" ON "workspace_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workspace_domain_domain_idx" ON "workspace_domain" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "workspace_domain_cf_hostname_id_idx" ON "workspace_domain" USING btree ("cloudflare_hostname_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_org_slug_idx" ON "boards" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "boards_org_id_idx" ON "boards" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmaps_org_slug_idx" ON "roadmaps" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "roadmaps_org_id_idx" ON "roadmaps" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "roadmaps_position_idx" ON "roadmaps" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_idx" ON "tags" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "tags_org_id_idx" ON "tags" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_statuses_org_slug_idx" ON "post_statuses" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "post_statuses_org_id_idx" ON "post_statuses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "post_statuses_position_idx" ON "post_statuses" USING btree ("organization_id","category","position");--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_id_idx" ON "comment_reactions" USING btree ("comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_unique_idx" ON "comment_reactions" USING btree ("comment_id","user_identifier","emoji");--> statement-breakpoint
CREATE INDEX "comments_org_id_idx" ON "comments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comments_post_id_idx" ON "comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "comments_parent_id_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_member_id_idx" ON "comments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "comments_created_at_idx" ON "comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comments_post_created_at_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_roadmaps_pk" ON "post_roadmaps" USING btree ("post_id","roadmap_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_post_id_idx" ON "post_roadmaps" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_roadmap_id_idx" ON "post_roadmaps" USING btree ("roadmap_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_position_idx" ON "post_roadmaps" USING btree ("roadmap_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "post_tags_pk" ON "post_tags" USING btree ("post_id","tag_id");--> statement-breakpoint
CREATE INDEX "post_tags_post_id_idx" ON "post_tags" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_tags_tag_id_idx" ON "post_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "posts_org_id_idx" ON "posts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "posts_board_id_idx" ON "posts" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "posts_status_id_idx" ON "posts" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "posts_member_id_idx" ON "posts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "posts_owner_member_id_idx" ON "posts" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "posts_owner_id_idx" ON "posts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "posts_created_at_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "posts_vote_count_idx" ON "posts" USING btree ("vote_count");--> statement-breakpoint
CREATE INDEX "posts_board_vote_count_idx" ON "posts" USING btree ("board_id","vote_count");--> statement-breakpoint
CREATE INDEX "posts_board_created_at_idx" ON "posts" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_board_status_id_idx" ON "posts" USING btree ("board_id","status_id");--> statement-breakpoint
CREATE INDEX "posts_member_created_at_idx" ON "posts" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_org_board_vote_created_idx" ON "posts" USING btree ("organization_id","board_id","vote_count");--> statement-breakpoint
CREATE INDEX "posts_with_status_idx" ON "posts" USING btree ("status_id","vote_count") WHERE status_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_search_vector_idx" ON "posts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "posts_deleted_at_idx" ON "posts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "votes_org_id_idx" ON "votes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "votes_post_id_idx" ON "votes" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_unique_idx" ON "votes" USING btree ("post_id","user_identifier");--> statement-breakpoint
CREATE INDEX "votes_member_id_idx" ON "votes" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "votes_member_created_at_idx" ON "votes" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_event_mappings_lookup" ON "integration_event_mappings" USING btree ("integration_id","event_type","enabled");--> statement-breakpoint
CREATE INDEX "idx_linked_entities_lookup" ON "integration_linked_entities" USING btree ("integration_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_sync_log_integration_created" ON "integration_sync_log" USING btree ("integration_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_org_integrations_org" ON "organization_integrations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_integrations_type_status" ON "organization_integrations" USING btree ("integration_type","status");--> statement-breakpoint
CREATE INDEX "changelog_board_id_idx" ON "changelog_entries" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "changelog_published_at_idx" ON "changelog_entries" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "notification_preferences_member_idx" ON "notification_preferences" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_subscriptions_unique" ON "post_subscriptions" USING btree ("post_id","member_id");--> statement-breakpoint
CREATE INDEX "post_subscriptions_member_idx" ON "post_subscriptions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "post_subscriptions_post_idx" ON "post_subscriptions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_subscriptions_post_active_idx" ON "post_subscriptions" USING btree ("post_id") WHERE muted = false;--> statement-breakpoint
CREATE INDEX "unsubscribe_tokens_token_idx" ON "unsubscribe_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "unsubscribe_tokens_member_idx" ON "unsubscribe_tokens" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_org_id_idx" ON "subscription" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_stripe_customer_idx" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "subscription_stripe_sub_idx" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "comment_edit_history_comment_id_idx" ON "comment_edit_history" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_edit_history_org_id_idx" ON "comment_edit_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comment_edit_history_created_at_idx" ON "comment_edit_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "post_edit_history_post_id_idx" ON "post_edit_history" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_edit_history_org_id_idx" ON "post_edit_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "post_edit_history_created_at_idx" ON "post_edit_history" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "boards_tenant_isolation" ON "boards" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "roadmaps_tenant_isolation" ON "roadmaps" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tags_tenant_isolation" ON "tags" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "post_statuses_tenant_isolation" ON "post_statuses" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "comment_reactions_tenant_isolation" ON "comment_reactions" AS PERMISSIVE FOR ALL TO "app_user" USING (comment_id IN (
  SELECT id FROM comments WHERE organization_id = current_setting('app.organization_id', true)::uuid
)) WITH CHECK (comment_id IN (
  SELECT id FROM comments WHERE organization_id = current_setting('app.organization_id', true)::uuid
));--> statement-breakpoint
CREATE POLICY "comments_tenant_isolation" ON "comments" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "post_roadmaps_tenant_isolation" ON "post_roadmaps" AS PERMISSIVE FOR ALL TO "app_user" USING (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)::uuid
)) WITH CHECK (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)::uuid
));--> statement-breakpoint
CREATE POLICY "post_tags_tenant_isolation" ON "post_tags" AS PERMISSIVE FOR ALL TO "app_user" USING (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)::uuid
)) WITH CHECK (post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)::uuid
));--> statement-breakpoint
CREATE POLICY "posts_tenant_isolation" ON "posts" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "votes_tenant_isolation" ON "votes" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "org_integrations_isolation" ON "organization_integrations" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "changelog_tenant_isolation" ON "changelog_entries" AS PERMISSIVE FOR ALL TO "app_user" USING (board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)::uuid
)) WITH CHECK (board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)::uuid
));--> statement-breakpoint
CREATE POLICY "notification_preferences_tenant_isolation" ON "notification_preferences" AS PERMISSIVE FOR ALL TO "app_user" USING (member_id IN (
  SELECT id FROM member
  WHERE organization_id = current_setting('app.organization_id', true)::uuid
)) WITH CHECK (member_id IN (
  SELECT id FROM member
  WHERE organization_id = current_setting('app.organization_id', true)::uuid
));--> statement-breakpoint
CREATE POLICY "post_subscriptions_tenant_isolation" ON "post_subscriptions" AS PERMISSIVE FOR ALL TO "app_user" USING (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)::uuid
)) WITH CHECK (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)::uuid
));--> statement-breakpoint
CREATE POLICY "subscription_tenant_isolation" ON "subscription" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "comment_edit_history_tenant_isolation" ON "comment_edit_history" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "post_edit_history_tenant_isolation" ON "post_edit_history" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;--> statement-breakpoint
-- PostgreSQL 16+ requires explicit SET option for role membership to allow SET ROLE
DO $$
BEGIN
  EXECUTE format('GRANT app_user TO %I WITH SET TRUE', current_user);
END $$;