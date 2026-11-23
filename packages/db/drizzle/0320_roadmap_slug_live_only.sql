-- @contract: safe-after 0.15.0 (the plain unique constraint becomes a partial unique index of the same name; every row valid before stays valid, and 0.15.0 still checks the slug itself before insert)
-- A deleted roadmap no longer reserves its slug: only live roadmaps must have
-- a unique slug, as with segments.
ALTER TABLE "roadmaps" DROP CONSTRAINT IF EXISTS "roadmaps_slug_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "roadmaps_slug_unique" ON "roadmaps" ("slug") WHERE deleted_at IS NULL;
