CREATE ROLE "app_user";--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_org_id() RETURNS text AS $$
BEGIN
  RETURN NULLIF(current_setting('app.organization_id', true), '');
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_id() TO app_user;--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"logo_blob" "bytea",
	"logo_type" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	"auth_config" text,
	"portal_config" text,
	"branding_config" text,
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
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "session_transfer_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"target_domain" text NOT NULL,
	"callback_url" text NOT NULL,
	"context" text DEFAULT 'team' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_transfer_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"domain_type" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"verification_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_domain_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
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
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadmaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
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
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_identifier" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"parent_id" uuid,
	"member_id" text,
	"author_id" text,
	"author_name" text,
	"author_email" text,
	"content" text NOT NULL,
	"is_team_member" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_roadmaps" (
	"post_id" uuid NOT NULL,
	"roadmap_id" uuid NOT NULL
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
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_json" jsonb,
	"member_id" text,
	"author_id" text,
	"author_name" text,
	"author_email" text,
	"status" text DEFAULT 'open' NOT NULL,
	"status_id" uuid,
	"owner_member_id" text,
	"owner_id" text,
	"estimated" text,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"official_response" text,
	"official_response_member_id" text,
	"official_response_author_id" text,
	"official_response_author_name" text,
	"official_response_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_identifier" text NOT NULL,
	"member_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"board_id" uuid,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "changelog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changelog_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_id_post_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."post_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_owner_member_id_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_official_response_member_id_member_id_fk" FOREIGN KEY ("official_response_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD CONSTRAINT "changelog_entries_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_org_idx" ON "member" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_transfer_token_token_idx" ON "session_transfer_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sso_provider_org_id_idx" ON "sso_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_provider_org_domain_idx" ON "sso_provider" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_org_idx" ON "user" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "user_org_id_idx" ON "user" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workspace_domain_org_id_idx" ON "workspace_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_org_slug_idx" ON "boards" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "boards_org_id_idx" ON "boards" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmaps_board_slug_idx" ON "roadmaps" USING btree ("board_id","slug");--> statement-breakpoint
CREATE INDEX "roadmaps_board_id_idx" ON "roadmaps" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_idx" ON "tags" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "tags_org_id_idx" ON "tags" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_statuses_org_slug_idx" ON "post_statuses" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "post_statuses_org_id_idx" ON "post_statuses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "post_statuses_position_idx" ON "post_statuses" USING btree ("organization_id","category","position");--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_id_idx" ON "comment_reactions" USING btree ("comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_unique_idx" ON "comment_reactions" USING btree ("comment_id","user_identifier","emoji");--> statement-breakpoint
CREATE INDEX "comments_post_id_idx" ON "comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "comments_parent_id_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_member_id_idx" ON "comments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "comments_created_at_idx" ON "comments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_roadmaps_pk" ON "post_roadmaps" USING btree ("post_id","roadmap_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_post_id_idx" ON "post_roadmaps" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_roadmaps_roadmap_id_idx" ON "post_roadmaps" USING btree ("roadmap_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_tags_pk" ON "post_tags" USING btree ("post_id","tag_id");--> statement-breakpoint
CREATE INDEX "post_tags_post_id_idx" ON "post_tags" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_tags_tag_id_idx" ON "post_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "posts_board_id_idx" ON "posts" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "posts_status_idx" ON "posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "posts_status_id_idx" ON "posts" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "posts_member_id_idx" ON "posts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "posts_owner_member_id_idx" ON "posts" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "posts_owner_id_idx" ON "posts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "posts_created_at_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "posts_vote_count_idx" ON "posts" USING btree ("vote_count");--> statement-breakpoint
CREATE INDEX "votes_post_id_idx" ON "votes" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_unique_idx" ON "votes" USING btree ("post_id","user_identifier");--> statement-breakpoint
CREATE INDEX "votes_member_id_idx" ON "votes" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "integrations_org_id_idx" ON "integrations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integrations_type_idx" ON "integrations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "integrations_board_id_idx" ON "integrations" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "changelog_board_id_idx" ON "changelog_entries" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "changelog_published_at_idx" ON "changelog_entries" USING btree ("published_at");--> statement-breakpoint
CREATE POLICY "boards_tenant_isolation" ON "boards" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "roadmaps_tenant_isolation" ON "roadmaps" AS PERMISSIVE FOR ALL TO "app_user" USING (board_id IN (SELECT id FROM boards WHERE organization_id = current_setting('app.organization_id', true))) WITH CHECK (board_id IN (SELECT id FROM boards WHERE organization_id = current_setting('app.organization_id', true)));--> statement-breakpoint
CREATE POLICY "tags_tenant_isolation" ON "tags" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "post_statuses_tenant_isolation" ON "post_statuses" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "comment_reactions_tenant_isolation" ON "comment_reactions" AS PERMISSIVE FOR ALL TO "app_user" USING (comment_id IN (
  SELECT c.id FROM comments c
  JOIN posts p ON c.post_id = p.id
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (comment_id IN (
  SELECT c.id FROM comments c
  JOIN posts p ON c.post_id = p.id
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
CREATE POLICY "comments_tenant_isolation" ON "comments" AS PERMISSIVE FOR ALL TO "app_user" USING (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
CREATE POLICY "post_roadmaps_tenant_isolation" ON "post_roadmaps" AS PERMISSIVE FOR ALL TO "app_user" USING (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
CREATE POLICY "post_tags_tenant_isolation" ON "post_tags" AS PERMISSIVE FOR ALL TO "app_user" USING (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
CREATE POLICY "posts_tenant_isolation" ON "posts" AS PERMISSIVE FOR ALL TO "app_user" USING (board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
CREATE POLICY "votes_tenant_isolation" ON "votes" AS PERMISSIVE FOR ALL TO "app_user" USING (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
CREATE POLICY "integrations_tenant_isolation" ON "integrations" AS PERMISSIVE FOR ALL TO "app_user" USING (organization_id = current_setting('app.organization_id', true)) WITH CHECK (organization_id = current_setting('app.organization_id', true));--> statement-breakpoint
CREATE POLICY "changelog_tenant_isolation" ON "changelog_entries" AS PERMISSIVE FOR ALL TO "app_user" USING (board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)
)) WITH CHECK (board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)
));--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;