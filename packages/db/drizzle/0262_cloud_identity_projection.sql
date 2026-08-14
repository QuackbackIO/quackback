-- A distinct, workspace-safe identity projection from the control plane.
-- NULL is the permanent default for self-hosted installs.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloud_identity" jsonb;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloud_identity_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "settings"."cloud_identity" IS
  'Signed, versioned customer-safe cloud identity projection. NULL on self-hosted installs.';
--> statement-breakpoint
COMMENT ON COLUMN "settings"."cloud_identity_revision" IS
  'Local change token for accepted cloud identity projections; distinct from billing projection versions.';
