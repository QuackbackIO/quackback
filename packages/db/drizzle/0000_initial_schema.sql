-- Quackback Initial Schema
-- Consolidated migration for clean database setup
-- Generated: 2024-12-08

--------------------------------------------------------------------------------
-- ROLES AND HELPER FUNCTIONS
--------------------------------------------------------------------------------

-- Create app_user role for RLS (if not exists)
DO $$ BEGIN
  CREATE ROLE "app_user";
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Helper function to safely get organization_id from session
CREATE OR REPLACE FUNCTION app_org_id() RETURNS text AS $$
BEGIN
  RETURN NULLIF(current_setting('app.organization_id', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute to app_user
GRANT EXECUTE ON FUNCTION app_org_id() TO app_user;

--------------------------------------------------------------------------------
-- AUTH TABLES (Better-Auth)
--------------------------------------------------------------------------------

CREATE TABLE "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "image_blob" bytea,
  "image_type" text,
  "organization_id" text NOT NULL,
  "metadata" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organization" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  "metadata" text,
  -- Auth settings
  "strict_sso_mode" boolean DEFAULT false NOT NULL,
  "password_auth_enabled" boolean DEFAULT true NOT NULL,
  "google_oauth_enabled" boolean DEFAULT true NOT NULL,
  "github_oauth_enabled" boolean DEFAULT true NOT NULL,
  "microsoft_oauth_enabled" boolean DEFAULT true NOT NULL,
  "open_signup_enabled" boolean DEFAULT false NOT NULL,
  -- Portal settings
  "portal_auth_enabled" boolean DEFAULT true NOT NULL,
  "portal_password_enabled" boolean DEFAULT true NOT NULL,
  "portal_google_enabled" boolean DEFAULT true NOT NULL,
  "portal_github_enabled" boolean DEFAULT true NOT NULL,
  "portal_require_auth" boolean DEFAULT false NOT NULL,
  "portal_public_voting" boolean DEFAULT true NOT NULL,
  "portal_public_commenting" boolean DEFAULT true NOT NULL,
  "theme_config" text,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);

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

CREATE TABLE "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL,
  "active_organization_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "session_token_unique" UNIQUE("token")
);

CREATE TABLE "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "member" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE "invitation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "inviter_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

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

--------------------------------------------------------------------------------
-- APPLICATION TABLES
--------------------------------------------------------------------------------

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
ALTER TABLE "boards" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "post_statuses" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "color" text DEFAULT '#6b7280' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "roadmaps" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "votes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "post_id" uuid NOT NULL,
  "user_identifier" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "votes" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "comment_reactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" uuid NOT NULL,
  "user_identifier" text NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "comment_reactions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "post_tags" (
  "post_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL
);
ALTER TABLE "post_tags" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "post_roadmaps" (
  "post_id" uuid NOT NULL,
  "roadmap_id" uuid NOT NULL
);
ALTER TABLE "post_roadmaps" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "changelog_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "board_id" uuid NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "changelog_entries" ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- FOREIGN KEY CONSTRAINTS
--------------------------------------------------------------------------------

-- Auth tables
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk"
  FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE cascade;
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "session_transfer_token" ADD CONSTRAINT "session_transfer_token_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
ALTER TABLE "workspace_domain" ADD CONSTRAINT "workspace_domain_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;

-- Application tables
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_board_id_boards_id_fk"
  FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE cascade;
ALTER TABLE "posts" ADD CONSTRAINT "posts_board_id_boards_id_fk"
  FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE cascade;
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_id_post_statuses_id_fk"
  FOREIGN KEY ("status_id") REFERENCES "post_statuses"("id") ON DELETE set null;
ALTER TABLE "posts" ADD CONSTRAINT "posts_member_id_member_id_fk"
  FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE set null;
ALTER TABLE "posts" ADD CONSTRAINT "posts_owner_member_id_member_id_fk"
  FOREIGN KEY ("owner_member_id") REFERENCES "member"("id") ON DELETE set null;
ALTER TABLE "posts" ADD CONSTRAINT "posts_official_response_member_id_member_id_fk"
  FOREIGN KEY ("official_response_member_id") REFERENCES "member"("id") ON DELETE set null;
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE cascade;
ALTER TABLE "comments" ADD CONSTRAINT "comments_member_id_member_id_fk"
  FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE set null;
ALTER TABLE "votes" ADD CONSTRAINT "votes_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE cascade;
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk"
  FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE cascade;
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE cascade;
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE cascade;
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE cascade;
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_roadmap_id_roadmaps_id_fk"
  FOREIGN KEY ("roadmap_id") REFERENCES "roadmaps"("id") ON DELETE cascade;
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_board_id_boards_id_fk"
  FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE cascade;
ALTER TABLE "changelog_entries" ADD CONSTRAINT "changelog_entries_board_id_boards_id_fk"
  FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE cascade;

--------------------------------------------------------------------------------
-- INDEXES
--------------------------------------------------------------------------------

-- Auth indexes
CREATE INDEX "account_userId_idx" ON "account" ("user_id");
CREATE INDEX "session_userId_idx" ON "session" ("user_id");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX "member_organizationId_idx" ON "member" ("organization_id");
CREATE INDEX "member_userId_idx" ON "member" ("user_id");
CREATE INDEX "invitation_organizationId_idx" ON "invitation" ("organization_id");
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");
CREATE UNIQUE INDEX "user_email_org_unique_idx" ON "user" ("email", "organization_id");
CREATE INDEX "user_organization_id_idx" ON "user" ("organization_id");
CREATE INDEX "sso_provider_org_id_idx" ON "sso_provider" ("organization_id");
CREATE UNIQUE INDEX "sso_provider_domain_idx" ON "sso_provider" ("domain");
CREATE INDEX "session_transfer_token_token_idx" ON "session_transfer_token" ("token");
CREATE INDEX "session_transfer_token_expires_at_idx" ON "session_transfer_token" ("expires_at");
CREATE INDEX "workspace_domain_org_id_idx" ON "workspace_domain" ("organization_id");

-- Application indexes
CREATE UNIQUE INDEX "boards_org_slug_idx" ON "boards" ("organization_id", "slug");
CREATE INDEX "boards_org_id_idx" ON "boards" ("organization_id");
CREATE INDEX "idx_boards_org_public" ON "boards" ("organization_id", "is_public");

CREATE UNIQUE INDEX "post_statuses_org_slug_idx" ON "post_statuses" ("organization_id", "slug");
CREATE INDEX "post_statuses_org_id_idx" ON "post_statuses" ("organization_id");
CREATE INDEX "post_statuses_position_idx" ON "post_statuses" ("organization_id", "category", "position");
CREATE INDEX "idx_post_statuses_org" ON "post_statuses" ("organization_id");

CREATE UNIQUE INDEX "tags_org_name_idx" ON "tags" ("organization_id", "name");
CREATE INDEX "tags_org_id_idx" ON "tags" ("organization_id");

CREATE UNIQUE INDEX "roadmaps_board_slug_idx" ON "roadmaps" ("board_id", "slug");
CREATE INDEX "roadmaps_board_id_idx" ON "roadmaps" ("board_id");

CREATE INDEX "posts_board_id_idx" ON "posts" ("board_id");
CREATE INDEX "posts_status_idx" ON "posts" ("status");
CREATE INDEX "posts_status_id_idx" ON "posts" ("status_id");
CREATE INDEX "posts_owner_id_idx" ON "posts" ("owner_id");
CREATE INDEX "posts_created_at_idx" ON "posts" ("created_at");
CREATE INDEX "posts_vote_count_idx" ON "posts" ("vote_count");
CREATE INDEX "posts_member_id_idx" ON "posts" ("member_id");
CREATE INDEX "posts_owner_member_id_idx" ON "posts" ("owner_member_id");
CREATE INDEX "idx_posts_board_status" ON "posts" ("board_id", "status");
CREATE INDEX "idx_posts_board_created" ON "posts" ("board_id", "created_at" DESC);

CREATE INDEX "comments_post_id_idx" ON "comments" ("post_id");
CREATE INDEX "comments_parent_id_idx" ON "comments" ("parent_id");
CREATE INDEX "comments_created_at_idx" ON "comments" ("created_at");
CREATE INDEX "comments_member_id_idx" ON "comments" ("member_id");
CREATE INDEX "idx_comments_post" ON "comments" ("post_id", "created_at" ASC);

CREATE INDEX "votes_post_id_idx" ON "votes" ("post_id");
CREATE UNIQUE INDEX "votes_unique_idx" ON "votes" ("post_id", "user_identifier");
CREATE INDEX "idx_votes_post_user" ON "votes" ("post_id", "user_identifier");

CREATE INDEX "comment_reactions_comment_id_idx" ON "comment_reactions" ("comment_id");
CREATE UNIQUE INDEX "comment_reactions_unique_idx" ON "comment_reactions" ("comment_id", "user_identifier", "emoji");

CREATE UNIQUE INDEX "post_tags_pk" ON "post_tags" ("post_id", "tag_id");
CREATE INDEX "post_tags_post_id_idx" ON "post_tags" ("post_id");
CREATE INDEX "post_tags_tag_id_idx" ON "post_tags" ("tag_id");
CREATE INDEX "idx_post_tags_post" ON "post_tags" ("post_id");
CREATE INDEX "idx_post_tags_tag" ON "post_tags" ("tag_id");

CREATE UNIQUE INDEX "post_roadmaps_pk" ON "post_roadmaps" ("post_id", "roadmap_id");
CREATE INDEX "post_roadmaps_post_id_idx" ON "post_roadmaps" ("post_id");
CREATE INDEX "post_roadmaps_roadmap_id_idx" ON "post_roadmaps" ("roadmap_id");

CREATE INDEX "integrations_org_id_idx" ON "integrations" ("organization_id");
CREATE INDEX "integrations_type_idx" ON "integrations" ("type");
CREATE INDEX "integrations_board_id_idx" ON "integrations" ("board_id");

CREATE INDEX "changelog_board_id_idx" ON "changelog_entries" ("board_id");
CREATE INDEX "changelog_published_at_idx" ON "changelog_entries" ("published_at");

--------------------------------------------------------------------------------
-- ROW LEVEL SECURITY POLICIES
--------------------------------------------------------------------------------

-- Direct organization_id tables
CREATE POLICY "boards_tenant_isolation" ON "boards" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

CREATE POLICY "tags_tenant_isolation" ON "tags" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

CREATE POLICY "integrations_tenant_isolation" ON "integrations" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

CREATE POLICY "post_statuses_tenant_isolation" ON "post_statuses" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

-- Tables with board_id -> organization
CREATE POLICY "roadmaps_tenant_isolation" ON "roadmaps" AS PERMISSIVE FOR ALL TO "app_user"
  USING (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()))
  WITH CHECK (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()));

CREATE POLICY "posts_tenant_isolation" ON "posts" AS PERMISSIVE FOR ALL TO "app_user"
  USING (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()))
  WITH CHECK (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()));

CREATE POLICY "changelog_tenant_isolation" ON "changelog_entries" AS PERMISSIVE FOR ALL TO "app_user"
  USING (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()))
  WITH CHECK (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()));

-- Tables with post_id -> board_id -> organization
CREATE POLICY "comments_tenant_isolation" ON "comments" AS PERMISSIVE FOR ALL TO "app_user"
  USING (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ))
  WITH CHECK (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ));

CREATE POLICY "votes_tenant_isolation" ON "votes" AS PERMISSIVE FOR ALL TO "app_user"
  USING (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ))
  WITH CHECK (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ));

CREATE POLICY "post_tags_tenant_isolation" ON "post_tags" AS PERMISSIVE FOR ALL TO "app_user"
  USING (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ))
  WITH CHECK (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ));

CREATE POLICY "post_roadmaps_tenant_isolation" ON "post_roadmaps" AS PERMISSIVE FOR ALL TO "app_user"
  USING (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ))
  WITH CHECK (post_id IN (
    SELECT p.id FROM posts p
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ));

-- Tables with comment_id -> post_id -> board_id -> organization
CREATE POLICY "comment_reactions_tenant_isolation" ON "comment_reactions" AS PERMISSIVE FOR ALL TO "app_user"
  USING (comment_id IN (
    SELECT c.id FROM comments c
    JOIN posts p ON c.post_id = p.id
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ))
  WITH CHECK (comment_id IN (
    SELECT c.id FROM comments c
    JOIN posts p ON c.post_id = p.id
    JOIN boards b ON p.board_id = b.id
    WHERE b.organization_id = app_org_id()
  ));

--------------------------------------------------------------------------------
-- PERMISSIONS
--------------------------------------------------------------------------------

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO app_user;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Grant sequence permissions (for auto-increment/uuid columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Ensure future tables also grant permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

--------------------------------------------------------------------------------
-- OPTIONAL: pg_cron for token cleanup (gracefully handles missing extension)
--------------------------------------------------------------------------------

DO $outer$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'cleanup-expired-tokens',
    '0 * * * *',
    'DELETE FROM session_transfer_token WHERE expires_at < NOW()'
  );
  RAISE NOTICE 'pg_cron enabled: scheduled cleanup-expired-tokens job';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available: %. Token cleanup will not be automated.', SQLERRM;
END
$outer$;
