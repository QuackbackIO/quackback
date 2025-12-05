-- Fix RLS policies to use a helper function for organization_id
-- This ensures type consistency and handles edge cases

-- Drop existing function if it exists (handles type change scenario)
DROP FUNCTION IF EXISTS app_org_id();

-- Create a helper function to safely get the organization_id as TEXT
-- (organization_id columns are TEXT type in this schema)
CREATE OR REPLACE FUNCTION app_org_id() RETURNS text AS $$
BEGIN
  RETURN NULLIF(current_setting('app.organization_id', true), '');
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute to app_user
GRANT EXECUTE ON FUNCTION app_org_id() TO app_user;

-- Drop and recreate policies with the helper function

-- boards
DROP POLICY IF EXISTS "boards_tenant_isolation" ON "boards";
CREATE POLICY "boards_tenant_isolation" ON "boards" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

-- tags
DROP POLICY IF EXISTS "tags_tenant_isolation" ON "tags";
CREATE POLICY "tags_tenant_isolation" ON "tags" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

-- integrations
DROP POLICY IF EXISTS "integrations_tenant_isolation" ON "integrations";
CREATE POLICY "integrations_tenant_isolation" ON "integrations" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

-- post_statuses
DROP POLICY IF EXISTS "post_statuses_tenant_isolation" ON "post_statuses";
CREATE POLICY "post_statuses_tenant_isolation" ON "post_statuses" AS PERMISSIVE FOR ALL TO "app_user"
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

-- roadmaps (uses board_id -> boards.organization_id)
DROP POLICY IF EXISTS "roadmaps_tenant_isolation" ON "roadmaps";
CREATE POLICY "roadmaps_tenant_isolation" ON "roadmaps" AS PERMISSIVE FOR ALL TO "app_user"
  USING (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()))
  WITH CHECK (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()));

-- posts (uses board_id -> boards.organization_id)
DROP POLICY IF EXISTS "posts_tenant_isolation" ON "posts";
CREATE POLICY "posts_tenant_isolation" ON "posts" AS PERMISSIVE FOR ALL TO "app_user"
  USING (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()))
  WITH CHECK (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()));

-- comments (uses post_id -> posts.board_id -> boards.organization_id)
DROP POLICY IF EXISTS "comments_tenant_isolation" ON "comments";
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

-- votes (uses post_id -> posts.board_id -> boards.organization_id)
DROP POLICY IF EXISTS "votes_tenant_isolation" ON "votes";
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

-- post_tags (uses post_id -> posts.board_id -> boards.organization_id)
DROP POLICY IF EXISTS "post_tags_tenant_isolation" ON "post_tags";
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

-- post_roadmaps (uses post_id -> posts.board_id -> boards.organization_id)
DROP POLICY IF EXISTS "post_roadmaps_tenant_isolation" ON "post_roadmaps";
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

-- comment_reactions (uses comment_id -> comments.post_id -> posts.board_id -> boards.organization_id)
DROP POLICY IF EXISTS "comment_reactions_tenant_isolation" ON "comment_reactions";
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

-- changelog_entries (uses board_id -> boards.organization_id)
DROP POLICY IF EXISTS "changelog_tenant_isolation" ON "changelog_entries";
CREATE POLICY "changelog_tenant_isolation" ON "changelog_entries" AS PERMISSIVE FOR ALL TO "app_user"
  USING (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()))
  WITH CHECK (board_id IN (SELECT id FROM boards WHERE organization_id = app_org_id()));
