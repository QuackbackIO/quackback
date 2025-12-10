-- Migration: Organization-scoped users (unified auth model)
--
-- This migration implements true multi-tenant user isolation:
-- 1. Adds organizationId to user table (users belong to one org)
-- 2. Changes email uniqueness from global to per-organization
-- 3. Removes portal_user table (merged into member with role='user')
--
-- All users (team + portal) now have:
-- - A user record scoped to their organization
-- - A member record with role: owner/admin/member/user

-- Step 1: Add organization_id column to user table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "organization_id" text;

-- Step 2: Migrate existing users - assign to their organization
-- For users with member records, use that organization
UPDATE "user" u
SET organization_id = m.organization_id
FROM "member" m
WHERE u.id = m.user_id
  AND u.organization_id IS NULL;

-- For users in portal_user but no member record, migrate them
UPDATE "user" u
SET organization_id = pu.organization_id
FROM "portal_user" pu
WHERE u.id = pu.user_id
  AND u.organization_id IS NULL;

-- Step 3: Handle orphan users (no org association)
-- Delete users without organization (shouldn't exist in normal flow)
DELETE FROM "user" WHERE organization_id IS NULL;

-- Step 4: Make organization_id NOT NULL and add FK constraint
ALTER TABLE "user" ALTER COLUMN "organization_id" SET NOT NULL;

-- Add FK constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_organization_id_organization_id_fk'
    AND table_name = 'user'
  ) THEN
    ALTER TABLE "user"
    ADD CONSTRAINT "user_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Step 5: Change email uniqueness from global to per-organization
DROP INDEX IF EXISTS "user_email_idx";
DROP INDEX IF EXISTS "user_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_org_idx" ON "user" ("organization_id", "email");

-- Add index on organization_id for faster lookups
CREATE INDEX IF NOT EXISTS "user_org_id_idx" ON "user" ("organization_id");

-- Step 6: Migrate portal_user records to member table with role='user'
INSERT INTO "member" ("id", "user_id", "organization_id", "role", "created_at")
SELECT gen_random_uuid()::text, "user_id", "organization_id", 'user', "created_at"
FROM "portal_user"
ON CONFLICT ("user_id", "organization_id") DO NOTHING;

-- Step 7: Drop portal_user table (no longer needed)
DROP TABLE IF EXISTS "portal_user";

-- Step 8: Add unique index on member (user_id, organization_id) if not exists
CREATE UNIQUE INDEX IF NOT EXISTS "member_user_org_idx" ON "member" ("user_id", "organization_id");
