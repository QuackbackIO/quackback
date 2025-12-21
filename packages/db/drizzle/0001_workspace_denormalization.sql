-- Migration: Workspace Denormalization and RLS Optimization
-- This migration adds workspace_id to junction tables for RLS performance,
-- adds comment_count to posts with trigger-based updates, updates indexes
-- to be workspace-prefixed, and adds RLS policies to auth tables.

-- ============================================================
-- STEP 1: Add workspace_id columns (nullable initially)
-- ============================================================

-- Junction tables
ALTER TABLE "post_tags" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "post_roadmaps" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "comment_reactions" ADD COLUMN "workspace_id" uuid;

-- Notification tables
ALTER TABLE "post_subscriptions" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "notification_preferences" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "unsubscribe_tokens" ADD COLUMN "workspace_id" uuid;

-- Integration tables
ALTER TABLE "integration_event_mappings" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "integration_linked_entities" ADD COLUMN "workspace_id" uuid;
ALTER TABLE "integration_sync_log" ADD COLUMN "workspace_id" uuid;

-- Add comment_count to posts
ALTER TABLE "posts" ADD COLUMN "comment_count" integer DEFAULT 0 NOT NULL;

-- ============================================================
-- STEP 2: Backfill workspace_id values from parent tables
-- ============================================================

-- Backfill post_tags from posts
UPDATE "post_tags" pt
SET "workspace_id" = p."workspace_id"
FROM "posts" p
WHERE pt."post_id" = p."id";

-- Backfill post_roadmaps from posts
UPDATE "post_roadmaps" pr
SET "workspace_id" = p."workspace_id"
FROM "posts" p
WHERE pr."post_id" = p."id";

-- Backfill comment_reactions from comments
UPDATE "comment_reactions" cr
SET "workspace_id" = c."workspace_id"
FROM "comments" c
WHERE cr."comment_id" = c."id";

-- Backfill post_subscriptions from posts
UPDATE "post_subscriptions" ps
SET "workspace_id" = p."workspace_id"
FROM "posts" p
WHERE ps."post_id" = p."id";

-- Backfill notification_preferences from member
UPDATE "notification_preferences" np
SET "workspace_id" = m."workspace_id"
FROM "member" m
WHERE np."member_id" = m."id";

-- Backfill unsubscribe_tokens from member
UPDATE "unsubscribe_tokens" ut
SET "workspace_id" = m."workspace_id"
FROM "member" m
WHERE ut."member_id" = m."id";

-- Backfill integration_event_mappings from workspace_integrations
UPDATE "integration_event_mappings" iem
SET "workspace_id" = wi."workspace_id"
FROM "workspace_integrations" wi
WHERE iem."integration_id" = wi."id";

-- Backfill integration_linked_entities from workspace_integrations
UPDATE "integration_linked_entities" ile
SET "workspace_id" = wi."workspace_id"
FROM "workspace_integrations" wi
WHERE ile."integration_id" = wi."id";

-- Backfill integration_sync_log from workspace_integrations
UPDATE "integration_sync_log" isl
SET "workspace_id" = wi."workspace_id"
FROM "workspace_integrations" wi
WHERE isl."integration_id" = wi."id";

-- Backfill comment_count on posts
UPDATE "posts" p
SET "comment_count" = (
  SELECT COUNT(*)
  FROM "comments" c
  WHERE c."post_id" = p."id" AND c."deleted_at" IS NULL
);

-- ============================================================
-- STEP 3: Add NOT NULL constraints
-- ============================================================

ALTER TABLE "post_tags" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "post_roadmaps" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "comment_reactions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "post_subscriptions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "notification_preferences" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "unsubscribe_tokens" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "integration_event_mappings" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "integration_linked_entities" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "integration_sync_log" ALTER COLUMN "workspace_id" SET NOT NULL;

-- ============================================================
-- STEP 4: Add foreign key constraints
-- ============================================================

ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "post_roadmaps" ADD CONSTRAINT "post_roadmaps_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "post_subscriptions" ADD CONSTRAINT "post_subscriptions_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "integration_event_mappings" ADD CONSTRAINT "integration_event_mappings_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "integration_linked_entities" ADD CONSTRAINT "integration_linked_entities_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "integration_sync_log" ADD CONSTRAINT "integration_sync_log_workspace_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;

-- ============================================================
-- STEP 5: Create comment_count trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only count if not soft-deleted
    IF NEW.deleted_at IS NULL THEN
      UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle soft delete/restore
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      -- Comment was soft-deleted
      UPDATE posts SET comment_count = comment_count - 1 WHERE id = NEW.post_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      -- Comment was restored
      UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only decrement if wasn't already soft-deleted
    IF OLD.deleted_at IS NULL THEN
      UPDATE posts SET comment_count = comment_count - 1 WHERE id = OLD.post_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_post_comment_count
AFTER INSERT OR UPDATE OF deleted_at OR DELETE ON comments
FOR EACH ROW
EXECUTE FUNCTION update_post_comment_count();

-- ============================================================
-- STEP 6: Drop old indexes
-- ============================================================

DROP INDEX IF EXISTS "posts_board_vote_count_idx";
DROP INDEX IF EXISTS "posts_board_created_at_idx";
DROP INDEX IF EXISTS "posts_board_status_id_idx";
DROP INDEX IF EXISTS "posts_member_created_at_idx";
DROP INDEX IF EXISTS "comments_post_created_at_idx";
DROP INDEX IF EXISTS "votes_unique_idx";
DROP INDEX IF EXISTS "post_subscriptions_unique";

-- ============================================================
-- STEP 7: Create new workspace-prefixed indexes
-- ============================================================

-- Posts table indexes
CREATE INDEX "posts_workspace_board_vote_idx" ON "posts" ("workspace_id", "board_id", "vote_count" DESC);
CREATE INDEX "posts_workspace_board_created_at_idx" ON "posts" ("workspace_id", "board_id", "created_at" DESC);
CREATE INDEX "posts_workspace_board_status_idx" ON "posts" ("workspace_id", "board_id", "status_id");
CREATE INDEX "posts_workspace_member_created_at_idx" ON "posts" ("workspace_id", "member_id", "created_at" DESC);

-- Comments table index
CREATE INDEX "comments_workspace_post_created_at_idx" ON "comments" ("workspace_id", "post_id", "created_at");

-- Votes table index
CREATE UNIQUE INDEX "votes_workspace_unique_idx" ON "votes" ("workspace_id", "post_id", "user_identifier");

-- Post subscriptions index
CREATE UNIQUE INDEX "post_subscriptions_workspace_unique" ON "post_subscriptions" ("workspace_id", "post_id", "member_id");

-- New workspace_id indexes on denormalized tables
CREATE INDEX "post_tags_workspace_id_idx" ON "post_tags" ("workspace_id");
CREATE INDEX "post_roadmaps_workspace_id_idx" ON "post_roadmaps" ("workspace_id");
CREATE INDEX "comment_reactions_workspace_id_idx" ON "comment_reactions" ("workspace_id");
CREATE INDEX "post_subscriptions_workspace_id_idx" ON "post_subscriptions" ("workspace_id");
CREATE INDEX "notification_preferences_workspace_id_idx" ON "notification_preferences" ("workspace_id");
CREATE INDEX "unsubscribe_tokens_workspace_id_idx" ON "unsubscribe_tokens" ("workspace_id");
CREATE INDEX "idx_event_mappings_workspace" ON "integration_event_mappings" ("workspace_id");
CREATE INDEX "idx_linked_entities_workspace" ON "integration_linked_entities" ("workspace_id");
CREATE INDEX "idx_sync_log_workspace" ON "integration_sync_log" ("workspace_id");

-- ============================================================
-- STEP 8: Drop old RLS policies
-- ============================================================

DROP POLICY IF EXISTS "post_tags_tenant_isolation" ON "post_tags";
DROP POLICY IF EXISTS "post_roadmaps_tenant_isolation" ON "post_roadmaps";
DROP POLICY IF EXISTS "comment_reactions_tenant_isolation" ON "comment_reactions";
DROP POLICY IF EXISTS "post_subscriptions_tenant_isolation" ON "post_subscriptions";
DROP POLICY IF EXISTS "notification_preferences_tenant_isolation" ON "notification_preferences";

-- ============================================================
-- STEP 9: Enable RLS on new tables and create policies
-- ============================================================

-- Enable RLS on auth tables
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_provider" ENABLE ROW LEVEL SECURITY;

-- Enable RLS on notification tables
ALTER TABLE "unsubscribe_tokens" ENABLE ROW LEVEL SECURITY;

-- Enable RLS on integration tables
ALTER TABLE "integration_event_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_linked_entities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_sync_log" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for auth tables
CREATE POLICY "member_tenant_isolation" ON "member" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "invitation_tenant_isolation" ON "invitation" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "sso_provider_tenant_isolation" ON "sso_provider" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- Create RLS policies for junction tables (now with direct workspace_id check)
CREATE POLICY "post_tags_tenant_isolation" ON "post_tags" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "post_roadmaps_tenant_isolation" ON "post_roadmaps" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "comment_reactions_tenant_isolation" ON "comment_reactions" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- Create RLS policies for notification tables
CREATE POLICY "post_subscriptions_tenant_isolation" ON "post_subscriptions" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "notification_preferences_tenant_isolation" ON "notification_preferences" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "unsubscribe_tokens_tenant_isolation" ON "unsubscribe_tokens" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- Create RLS policies for integration tables
CREATE POLICY "integration_event_mappings_isolation" ON "integration_event_mappings" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "integration_linked_entities_isolation" ON "integration_linked_entities" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY "integration_sync_log_isolation" ON "integration_sync_log" AS PERMISSIVE FOR ALL TO "app_user"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
