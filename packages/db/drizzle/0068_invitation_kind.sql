-- ============================================================================
-- invitation.kind column
-- ============================================================================
--
-- Adds a `kind` discriminator to the invitation table so that team invitations
-- and portal invitations can coexist without interfering with each other. A
-- composite index on (email, kind, status) accelerates the lookup paths used
-- by both flows (duplicate-check, accept, list).
--
-- Re-run-safe: guarded by IF NOT EXISTS / IF EXISTS where applicable.
-- ============================================================================

-- 1. Add the kind column with a default of 'team' so all existing rows remain valid.
ALTER TABLE "invitation"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'team';

-- 2. Composite index for lookup paths in both flows.
CREATE INDEX IF NOT EXISTS "invitation_email_kind_status_idx"
  ON "invitation" ("email", "kind", "status");
