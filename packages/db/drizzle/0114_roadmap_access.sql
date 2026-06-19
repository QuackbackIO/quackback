-- Replace the legacy `is_public` boolean on roadmaps with a richer `access`
-- jsonb, mirroring boards. Roadmaps only have a single `view` action, so the
-- shape is the minimal slice of BoardAccess: one tier + one segment allowlist.
ALTER TABLE "roadmaps" ADD COLUMN "access" jsonb DEFAULT '{"view":"anonymous","segments":{"view":[]}}'::jsonb NOT NULL;
--> statement-breakpoint
-- Backfill from the boolean:
--   is_public = true  → anyone can view ('anonymous')
--   is_public = false → workspace members only ('team')
-- No segment data existed before, so the allowlist starts empty in both cases.
-- This UPDATE is mandatory: without it every previously-private roadmap would
-- silently inherit the column default ('anonymous') and become public.
UPDATE "roadmaps" SET "access" = jsonb_build_object(
  'view', CASE WHEN "is_public" THEN 'anonymous' ELSE 'team' END,
  'segments', jsonb_build_object('view', '[]'::jsonb)
);
--> statement-breakpoint
DROP INDEX IF EXISTS "roadmaps_is_public_idx";
--> statement-breakpoint
ALTER TABLE "roadmaps" DROP COLUMN "is_public";
