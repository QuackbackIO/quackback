-- Multi-org team members refactoring
-- Team members (owner/admin/member) can belong to multiple orgs with global email uniqueness
-- Portal users (role='user') remain scoped to single org with per-org email uniqueness

-- Add user_type column to distinguish team vs portal users
ALTER TABLE "user" ADD COLUMN "user_type" text DEFAULT 'portal' NOT NULL;--> statement-breakpoint

-- Make organization_id nullable (team members won't have one set)
ALTER TABLE "user" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint

-- Drop the old unique constraint (email + organization_id)
DROP INDEX IF EXISTS "user_email_org_unique_idx";--> statement-breakpoint

-- Migrate existing team members: set user_type='team' and clear organization_id
-- Users with owner/admin/member roles become team members with global identity
UPDATE "user" u
SET user_type = 'team', organization_id = NULL
FROM "member" m
WHERE u.id = m.user_id AND m.role IN ('owner', 'admin', 'member');--> statement-breakpoint

-- Create partial unique index for portal users (email unique per organization)
CREATE UNIQUE INDEX "user_portal_email_org_idx" ON "user" (email, organization_id)
  WHERE user_type = 'portal';--> statement-breakpoint

-- Create partial unique index for team users (email globally unique)
CREATE UNIQUE INDEX "user_team_email_idx" ON "user" (email)
  WHERE user_type = 'team';--> statement-breakpoint

-- Add index for faster team user lookups by email
CREATE INDEX "user_team_email_lookup_idx" ON "user" (email) WHERE user_type = 'team';--> statement-breakpoint

-- Remove strictSsoMode from organization table (no longer needed)
ALTER TABLE "organization" DROP COLUMN IF EXISTS "strict_sso_mode";
