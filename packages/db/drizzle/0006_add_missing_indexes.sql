-- Custom SQL migration file, put your code below! --
-- Add missing indexes identified in SQL_QUERY_INDEX_ANALYSIS.md

-- Priority 1: Critical indexes for tenant resolution and auth
CREATE INDEX IF NOT EXISTS "workspace_domain_domain_idx" ON "workspace_domain" ("domain");
CREATE INDEX IF NOT EXISTS "sso_provider_domain_idx" ON "sso_provider" ("domain");

-- Priority 2: High impact composite indexes
CREATE INDEX IF NOT EXISTS "member_org_role_idx" ON "member" ("organization_id", "role");
CREATE INDEX IF NOT EXISTS "posts_board_vote_count_idx" ON "posts" ("board_id", "vote_count");
CREATE INDEX IF NOT EXISTS "posts_board_created_at_idx" ON "posts" ("board_id", "created_at");
CREATE INDEX IF NOT EXISTS "posts_board_status_idx" ON "posts" ("board_id", "status");
CREATE INDEX IF NOT EXISTS "comments_post_created_at_idx" ON "comments" ("post_id", "created_at");
