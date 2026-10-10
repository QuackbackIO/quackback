-- Per-tag portal visibility. Existing tags were always shown on the public
-- portal, so the default keeps that behaviour; admins opt individual tags out
-- to make them internal (team-only). Additive / expand-only.
ALTER TABLE "post_tags" ADD COLUMN IF NOT EXISTS "is_public" boolean DEFAULT true NOT NULL;
