-- Add audience visibility to changelog entries, mirroring roadmaps. This is
-- independent of the publish lifecycle (published_at): publish state decides
-- whether/when an entry is live; `access` decides who may see a live entry.
-- Purely additive — the column default makes every existing entry public
-- ('anonymous'), which preserves today's behavior, so no backfill is needed.
ALTER TABLE "changelog_entries" ADD COLUMN "access" jsonb DEFAULT '{"view":"anonymous","segments":{"view":[]}}'::jsonb NOT NULL;
