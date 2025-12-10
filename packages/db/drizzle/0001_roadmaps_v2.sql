-- Custom SQL migration file, put your code below! --
-- Migration: Evolve roadmaps to be organization-based with explicit post assignment

-- =============================================================================
-- STEP 1: Modify roadmaps table
-- =============================================================================

-- IMPORTANT: Drop the RLS policy FIRST since it depends on board_id column
DROP POLICY IF EXISTS "roadmaps_tenant_isolation" ON "roadmaps";

-- Add new columns
ALTER TABLE "roadmaps" ADD COLUMN IF NOT EXISTS "organization_id" text;
ALTER TABLE "roadmaps" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;

-- Migrate data: copy organization_id from related board (if any data exists)
UPDATE "roadmaps" r
SET "organization_id" = b."organization_id"
FROM "boards" b
WHERE r."board_id" = b."id"
  AND r."organization_id" IS NULL;

-- Make organization_id NOT NULL after migration
ALTER TABLE "roadmaps" ALTER COLUMN "organization_id" SET NOT NULL;

-- Drop old indexes
DROP INDEX IF EXISTS "roadmaps_board_slug_idx";
DROP INDEX IF EXISTS "roadmaps_board_id_idx";

-- Drop old foreign key constraint and column
ALTER TABLE "roadmaps" DROP CONSTRAINT IF EXISTS "roadmaps_board_id_boards_id_fk";
ALTER TABLE "roadmaps" DROP COLUMN IF EXISTS "board_id";

-- Create new indexes
CREATE UNIQUE INDEX IF NOT EXISTS "roadmaps_org_slug_idx" ON "roadmaps" ("organization_id", "slug");
CREATE INDEX IF NOT EXISTS "roadmaps_org_id_idx" ON "roadmaps" ("organization_id");
CREATE INDEX IF NOT EXISTS "roadmaps_position_idx" ON "roadmaps" ("organization_id", "position");

-- Recreate RLS policy using the new organization_id column
CREATE POLICY "roadmaps_tenant_isolation" ON "roadmaps"
  FOR ALL
  TO "app_user"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

-- =============================================================================
-- STEP 2: Modify post_roadmaps table
-- =============================================================================

-- Add new columns for status tracking and ordering
ALTER TABLE "post_roadmaps" ADD COLUMN IF NOT EXISTS "status_id" uuid REFERENCES "post_statuses"("id") ON DELETE SET NULL;
ALTER TABLE "post_roadmaps" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;

-- Create new index for ordering within roadmap columns
CREATE INDEX IF NOT EXISTS "post_roadmaps_position_idx" ON "post_roadmaps" ("roadmap_id", "status_id", "position");
