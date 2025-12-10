-- Migration: Simplify user schema to align with Better-Auth organization plugin
--
-- This migration:
-- 1. Removes userType and organizationId from user table (not part of Better-Auth schema)
-- 2. Creates portal_user table to track portal users per organization
-- 3. Migrates existing portal users (role='user') to portal_user table
-- 4. Removes role='user' from member table (only owner/admin/member remain)

-- Step 1: Create portal_user table to track portal users per org
CREATE TABLE IF NOT EXISTS "portal_user" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "portal_user_org_id_idx" ON "portal_user" ("organization_id");
CREATE INDEX IF NOT EXISTS "portal_user_user_id_idx" ON "portal_user" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_user_user_org_idx" ON "portal_user" ("user_id", "organization_id");

-- Step 2: Migrate existing portal users (role='user') to portal_user table
INSERT INTO "portal_user" ("id", "user_id", "organization_id", "created_at")
SELECT gen_random_uuid()::text, "user_id", "organization_id", "created_at"
FROM "member" WHERE role = 'user'
ON CONFLICT ("user_id", "organization_id") DO NOTHING;

-- Step 3: Delete member records with role='user' (now tracked in portal_user)
DELETE FROM "member" WHERE role = 'user';

-- Step 4: Remove userType and organizationId from user table
ALTER TABLE "user" DROP COLUMN IF EXISTS "user_type";
ALTER TABLE "user" DROP COLUMN IF EXISTS "organization_id";

-- Step 5: Drop old indexes related to userType and organizationId
DROP INDEX IF EXISTS "user_portal_email_org_idx";
DROP INDEX IF EXISTS "user_team_email_idx";
DROP INDEX IF EXISTS "user_organization_id_idx";

-- Step 6: Add simple global email uniqueness (if not exists)
-- Note: email should already be unique, but let's ensure it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'user_email_idx'
  ) THEN
    CREATE UNIQUE INDEX "user_email_idx" ON "user" ("email");
  END IF;
END $$;
