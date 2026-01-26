-- Add indexes for public filtering (used by all portal queries)
-- These indexes optimize WHERE is_public = true conditions

CREATE INDEX IF NOT EXISTS "boards_is_public_idx" ON "boards" ("is_public");
CREATE INDEX IF NOT EXISTS "roadmaps_is_public_idx" ON "roadmaps" ("is_public");
